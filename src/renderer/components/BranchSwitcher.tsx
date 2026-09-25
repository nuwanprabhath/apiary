import { useEffect, useMemo, useState } from 'react'
import type { GitRefEntry, GitRefs, WorktreeConflict } from '@shared/types'
import { exactRefMatch } from '../state/branchSelection'
import { CopyIcon, CheckIcon, ArrowDownIcon } from './icons'
import { updateBranchMessage } from '@shared/gitMessages'

interface Props {
  shellKey: string
  isPtyId: boolean
  onClose: () => void
  onCheckedOut: () => void
  onError: (message: string) => void
  /** Raised instead of an error when the branch is already checked out in another worktree. */
  onWorktreeConflict: (conflict: WorktreeConflict) => void
  /**
   * What picking a ref from the list does. 'checkout' is the branch switcher proper; 'merge'
   * reuses the very same searchable list of branches, remotes and tags to choose what to merge
   * *into* the current branch, rather than building a second, near-identical picker for it.
   */
  mode?: 'checkout' | 'merge'
  /** Current branch name, only used to say what a merge would be merging into. */
  currentBranch?: string | null
  /** Opens straight into naming a new branch, for the menu's "Create Branch..." command, rather
   *  than making the user find that action inside the list first. */
  startAt?: 'list' | 'name'
  /** A one-line result to show (the pull button's "Pulled 3 commits into main."). */
  onNotice?: (message: string) => void
  /** A branch moved (the pull button): the toolbar's ahead/behind is out of date. */
  onBranchUpdated?: () => void
}

type Step =
  | { kind: 'list' }
  | { kind: 'name'; from?: string }
  | { kind: 'pick-base' }
  | { kind: 'pick-detached' }

function matches(entry: GitRefEntry, query: string): boolean {
  return query === '' || entry.name.toLowerCase().includes(query)
}

export function BranchSwitcher({
  shellKey, isPtyId, onClose, onCheckedOut, onError, onWorktreeConflict, mode = 'checkout',
  currentBranch = null,
  startAt = 'list',
  onNotice,
  onBranchUpdated,
}: Props): JSX.Element {
  const [refs, setRefs] = useState<GitRefs | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState<Step>(startAt === 'name' ? { kind: 'name' } : { kind: 'list' })
  const [nameDraft, setNameDraft] = useState('')
  // Shown inside this modal itself — the modal's own backdrop (position:fixed, full-viewport,
  // 55% black wash) fully covers App.tsx's error-banner behind it, so a failed
  // checkout/create surfaces here instead of routing only through the parent's onError, which
  // would otherwise render invisibly behind the still-open modal.
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const pickingBaseNow = (s: Step): boolean => s.kind === 'pick-base' || s.kind === 'pick-detached'

  const reportError = (message: string): void => {
    setErrorMessage(message)
    onError(message)
  }

  /** The pull button beside a local branch: fast-forwards it from its upstream, in place. */
  const updateBranch = async (name: string): Promise<void> => {
    setErrorMessage(null)
    try {
      const { commits } = await window.apiary.gitUpdateBranch(shellKey, isPtyId, name)
      onNotice?.(updateBranchMessage(name, commits))
      onBranchUpdated?.()
      // The row's date, author and subject are the branch tip's, which may just have moved.
      void window.apiary.gitListRefs(shellKey, isPtyId).then(setRefs).catch(() => {})
    } catch (e) {
      reportError(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => {
    void window.apiary.gitListRefs(shellKey, isPtyId).then(setRefs).catch((e: Error) => onError(e.message))
    // Runs once on open — intentionally not re-fetching on every keystroke of `query`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * Escape dismisses the whole popup, from any step — the way a VS Code quick-pick does, and the
   * way anyone who has ever used one expects. Bound on the document rather than the modal's own
   * element because focus starts in the search input and moves between the list's buttons as you
   * arrow around; a handler on any single one of those would miss the others.
   *
   * `keydown`, not `keyup`: a key held down while the popup opens would otherwise close it again
   * on release. Deliberately closes outright rather than stepping back to the list from a
   * sub-step, so Escape means one thing here no matter where you are in it.
   */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [onClose])

  const q = query.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (refs === null) return { local: [], remote: [], tags: [] }
    return {
      local: refs.local.filter((r) => matches(r, q)),
      remote: refs.remote.filter((r) => matches(r, q)),
      tags: refs.tags.filter((r) => matches(r, q)),
    }
  }, [refs, q])

  const trimmedQuery = query.trim()
  const activeMatch = mode === 'checkout' && !pickingBaseNow(step)
    ? exactRefMatch(refs ?? { local: [], remote: [] }, trimmedQuery)
    : null

  const checkout = async (name: string): Promise<void> => {
    setErrorMessage(null)
    setBusy(true)
    try {
      const outcome = await window.apiary.gitCheckoutBranch(shellKey, isPtyId, name)
      if (!outcome.ok) {
        // Not an error, and not this popover's to solve: hand the conflict up and get out of the
        // way, so the choice is made in a dialog rather than inside a branch list.
        onClose()
        onWorktreeConflict(outcome.conflict)
        return
      }
      onCheckedOut()
      onClose()
    } catch (e) {
      reportError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const checkoutRemote = async (remoteRef: string): Promise<void> => {
    setErrorMessage(null)
    setBusy(true)
    try {
      const localName = remoteRef.slice(remoteRef.indexOf('/') + 1)
      await window.apiary.gitCheckoutRemote(shellKey, isPtyId, remoteRef, localName)
      onCheckedOut()
      onClose()
    } catch (e) {
      reportError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const checkoutDetached = async (ref: string): Promise<void> => {
    setErrorMessage(null)
    setBusy(true)
    try {
      await window.apiary.gitCheckoutDetached(shellKey, isPtyId, ref)
      onCheckedOut()
      onClose()
    } catch (e) {
      reportError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const mergeRef = async (ref: string): Promise<void> => {
    setErrorMessage(null)
    setBusy(true)
    try {
      await window.apiary.gitMerge(shellKey, isPtyId, ref)
      onCheckedOut()
      onClose()
    } catch (e) {
      // A conflicting merge leaves the tree mid-merge on purpose (see branchOps.merge), so the
      // popup stays open with git's own CONFLICT text in it rather than closing over a repo the
      // user now has to notice is halfway through something.
      reportError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  /** What a click on a ref row does, given which job this picker is currently doing. */
  const pickRef = (name: string, kind: 'local' | 'remote' | 'tag'): void => {
    if (mode === 'merge') { void mergeRef(name); return }
    if (step.kind === 'pick-base') { setNameDraft(''); setStep({ kind: 'name', from: name }); return }
    if (step.kind === 'pick-detached' || kind === 'tag') { void checkoutDetached(name); return }
    if (kind === 'remote') { void checkoutRemote(name); return }
    void checkout(name)
  }

  const createBranch = async (from?: string): Promise<void> => {
    const name = nameDraft.trim()
    if (name === '') return
    setErrorMessage(null)
    setBusy(true)
    try {
      await window.apiary.gitCreateBranch(shellKey, isPtyId, name, from)
      onCheckedOut()
      onClose()
    } catch (e) {
      reportError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (step.kind === 'name') {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal branch-switcher" data-testid="branch-switcher" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
          {errorMessage !== null && (
            <p className="error-banner" data-testid="branch-switcher-error">{errorMessage}</p>
          )}
          <input
            className="search"
            data-testid="branch-switcher-name-input"
            placeholder="Branch name"
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void createBranch(step.from) }}
          />
          <div className="modal-actions">
            <button data-testid="branch-switcher-cancel" onClick={() => { setErrorMessage(null); setStep({ kind: 'list' }) }}>Back</button>
            <button className="primary" data-testid="branch-switcher-confirm" disabled={busy || nameDraft.trim() === ''} onClick={() => { void createBranch(step.from) }}>
              Create branch
            </button>
          </div>
        </div>
      </div>
    )
  }

  const pickingBase = pickingBaseNow(step)
  // In merge mode the create/detached actions are meaningless — this list is only being used to
  // answer "merge what?".
  const showActions = !pickingBase && mode === 'checkout'
  const placeholder = mode === 'merge'
    ? `Select a branch to merge into ${currentBranch ?? 'HEAD'}`
    : pickingBase ? 'Select a ref to branch from' : 'Select a branch or tag to checkout'

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide branch-switcher" data-testid="branch-switcher" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        {errorMessage !== null && (
          <p className="error-banner" data-testid="branch-switcher-error">{errorMessage}</p>
        )}
        <input
          className="search"
          data-testid="branch-switcher-search"
          placeholder={placeholder}
          autoFocus
          value={query}
          onChange={(e) => { setQuery(e.target.value); setErrorMessage(null) }}
          onKeyDown={(e) => {
            // Same guard the row buttons get from `disabled={busy}`: without it, a checkout
            // already in flight (the modal stays open across its await) lets a second Enter
            // fire a second concurrent gitCheckoutBranch for the same ref.
            if (e.key !== 'Enter' || activeMatch === null || busy) return
            pickRef(activeMatch.entry.name, activeMatch.kind)
          }}
        />

        <ul className="branch-switcher-list">
          {showActions && (
            <>
              <li>
                <button className="branch-switcher-action" data-testid="branch-switcher-create" onClick={() => { setErrorMessage(null); setNameDraft(''); setStep({ kind: 'name' }) }}>
                  + Create new branch...
                </button>
              </li>
              <li>
                <button className="branch-switcher-action" data-testid="branch-switcher-create-from" onClick={() => { setErrorMessage(null); setStep({ kind: 'pick-base' }) }}>
                  + Create new branch from...
                </button>
              </li>
              <li>
                <button className="branch-switcher-action" data-testid="branch-switcher-detached" onClick={() => { setErrorMessage(null); setStep({ kind: 'pick-detached' }) }}>
                  Checkout detached...
                </button>
              </li>
            </>
          )}

          {refs === null && <li className="empty">Loading…</li>}

          {refs !== null && (
            <>
              <BranchSection
                title="branches" testId="branch-switcher-branch-row" rows={filtered.local} busy={busy}
                activeName={activeMatch?.kind === 'local' ? activeMatch.entry.name : null}
                onPick={(r) => pickRef(r.name, 'local')}
                onUpdate={updateBranch}
              />
              <BranchSection
                title="remote branches" testId="branch-switcher-remote-row" rows={filtered.remote} busy={busy}
                activeName={activeMatch?.kind === 'remote' ? activeMatch.entry.name : null}
                onPick={(r) => pickRef(r.name, 'remote')}
              />
              <BranchSection
                title="tags" testId="branch-switcher-tag-row" rows={filtered.tags} busy={busy}
                activeName={null}
                onPick={(r) => pickRef(r.name, 'tag')}
              />
            </>
          )}
        </ul>
      </div>
    </div>
  )
}

function BranchSection(
  { title, testId, rows, onPick, busy, activeName, onUpdate }:
  {
    title: string; testId: string; rows: GitRefEntry[]; onPick: (r: GitRefEntry) => void
    busy: boolean; activeName: string | null
    /** Local branches only: the pull button. */
    onUpdate?: (name: string) => Promise<void>
  },
): JSX.Element | null {
  if (rows.length === 0) return null
  return (
    <>
      <li className="branch-switcher-section-label">{title}</li>
      {rows.map((r) => (
        <li key={r.name} className="branch-switcher-item">
          <button
            className="branch-switcher-row"
            data-testid={testId}
            data-active={r.name === activeName}
            disabled={busy}
            onClick={() => onPick(r)}
          >
            <span className="branch-switcher-row-name">{r.name}</span>
            <span className="branch-switcher-row-meta">
              {r.relativeDate} &middot; {r.author} &middot; {r.shortSha} &middot; {r.subject}
            </span>
          </button>
          {onUpdate !== undefined && <PullRefButton name={r.name} onPull={onUpdate} />}
          <CopyRefButton name={r.name} />
        </li>
      ))}
    </>
  )
}

/**
 * Brings a local branch up to date with its upstream without picking it — beside the copy button,
 * shown the same way. Fast-forward only (see branchOps.updateBranch); busy while it runs, so one
 * click cannot start two pulls.
 */
function PullRefButton({ name, onPull }: { name: string; onPull: (name: string) => Promise<void> }): JSX.Element {
  const [busy, setBusy] = useState(false)
  return (
    <button
      className="branch-switcher-copy branch-switcher-pull"
      data-testid="branch-switcher-pull"
      data-busy={busy}
      disabled={busy}
      title={busy ? `Pulling ${name}…` : `Pull ${name} from its upstream`}
      aria-label={`Pull ${name}`}
      onClick={(e) => {
        e.stopPropagation()
        setBusy(true)
        void onPull(name).finally(() => { setBusy(false) })
      }}
    >
      <ArrowDownIcon />
    </button>
  )
}

/**
 * Copies a ref's name without picking it. A sibling of the row's button rather than inside it — a
 * button cannot hold another — shown on hover or keyboard focus, and enabled even while a checkout
 * is running, since copying changes nothing.
 */
function CopyRefButton({ name }: { name: string }): JSX.Element {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => { setCopied(false) }, 1200)
    return () => { clearTimeout(t) }
  }, [copied])
  return (
    <button
      className="branch-switcher-copy"
      data-testid="branch-switcher-copy"
      data-copied={copied}
      title={copied ? 'Copied' : `Copy ${name}`}
      aria-label={`Copy ${name}`}
      onClick={(e) => {
        e.stopPropagation()
        void window.apiary.copyToClipboard(name).then(() => { setCopied(true) })
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  )
}
