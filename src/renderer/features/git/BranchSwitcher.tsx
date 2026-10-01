import { type JSX, useEffect, useMemo, useRef, useState } from 'react'
import type { GitRefEntry, GitRefs, WorktreeConflict } from '@shared/types'
import type { TerminalRef } from '@shared/domain/ids'
import { exactRefMatch } from './branchSelection'
import { CopyIcon, CheckIcon, ArrowDownIcon } from '../../ui/icons'
import { updateBranchMessage } from '@shared/gitMessages'
import { describeError } from '../../ui/errors'
import { Modal } from '../../ui/Modal'

interface Props {
  terminal: TerminalRef
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

/** The rows this picker's Up/Down/Home/End move between: the "Create branch…" style actions and
 *  every visible branch/remote/tag row — not the per-row copy/pull buttons, which Tab still
 *  reaches in the ordinary order. */
const ROW_SELECTOR = '.branch-switcher-action, .branch-switcher-row'

/** UI-26: the finding's own words for this dialog were "focus moves between the list's buttons as
 *  you arrow around", which was never actually implemented — only an exact-match Enter worked.
 *  ArrowDown/Up move between rows (wrapping), Home/End to the ends; from the search input,
 *  ArrowDown enters the list at its first row. */
function onListKeyDown(e: React.KeyboardEvent, container: HTMLElement): void {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
  const rows = [...container.querySelectorAll<HTMLElement>(ROW_SELECTOR)]
  if (rows.length === 0) return
  const current = rows.indexOf(document.activeElement as HTMLElement)
  let next: number
  if (e.key === 'Home') next = 0
  else if (e.key === 'End') next = rows.length - 1
  else if (e.key === 'ArrowDown') next = current === -1 ? 0 : Math.min(current + 1, rows.length - 1)
  else next = current === -1 ? rows.length - 1 : Math.max(current - 1, 0)
  e.preventDefault()
  rows[next]?.focus()
}

export function BranchSwitcher({
  terminal, onClose, onCheckedOut, onError, onWorktreeConflict, mode = 'checkout',
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
  // 55% black wash) sits above everything behind it, so a failed checkout/create is reported here
  // rather than only through the parent's `onError` (a toast), which would show the same failure a
  // second time and read the Electron IPC wrapping raw if it did (see `run` below).
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // `onError` is a fresh arrow function on every render of the parent (SessionColumn re-renders on
  // every git-status poll), so it cannot honestly go in the fetch effect's deps below without
  // refetching the ref list on every one of those renders. A ref kept current on every render, and
  // never listed as a dependency, is the standard way to call "whatever the latest callback is"
  // from an effect that should not itself re-run when that callback changes identity.
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  const pickingBaseNow = (s: Step): boolean => s.kind === 'pick-base' || s.kind === 'pick-detached'

  /**
   * Runs one git action behind the shared busy flag, with one place that turns a failure into
   * something readable: `describeError` strips Electron's IPC wrapping (`Error invoking remote
   * method '…': Error: …`) rather than showing that raw text in the banner. Reported once, in the
   * banner only — `onError`'s toast would otherwise fire too, and duplicate every failure. Success
   * (`onCheckedOut`/`onClose`) is `op`'s to call, not `run`'s: `checkout`'s worktree-conflict case
   * closes without either, and a conflicting merge must not close at all (see `mergeRef`).
   */
  const run = async (op: () => Promise<void>): Promise<void> => {
    setErrorMessage(null)
    setBusy(true)
    try {
      await op()
    } catch (e) {
      setErrorMessage(describeError(e).message)
    } finally {
      setBusy(false)
    }
  }

  /** The pull button beside a local branch: fast-forwards it from its upstream, in place. Not
   *  routed through `run`: it has its own per-row busy state (`PullRefButton`) and must not
   *  disable the rest of the list while one branch updates. */
  const updateBranch = async (name: string): Promise<void> => {
    setErrorMessage(null)
    try {
      const { commits } = await window.apiary.gitUpdateBranch(terminal, name)
      onNotice?.(updateBranchMessage(name, commits))
      onBranchUpdated?.()
      // The row's date, author and subject are the branch tip's, which may just have moved.
      void window.apiary.gitListRefs(terminal).then(setRefs).catch(() => {})
    } catch (e) {
      setErrorMessage(describeError(e).message)
    }
  }

  useEffect(() => {
    let cancelled = false
    void window.apiary.gitListRefs(terminal)
      .then((r) => { if (!cancelled) setRefs(r) })
      .catch((e: Error) => { if (!cancelled) onErrorRef.current(e.message) })
    return () => { cancelled = true }
    // Deliberately keyed on [terminal] only, not `query`: re-fetching on every keystroke
    // of the search would be pointless work for a list that is filtered client-side. If the active
    // tab changes under an open modal (another window switches it), this now re-lists for the new
    // terminal instead of quietly going on showing the old repo's refs.
  }, [terminal])

  // UI-25: onto the shared Modal primitive, which registers Escape on the stack (UI-13) itself —
  // "dismisses the whole popup, from any step" is now Modal's own onClose contract, not something
  // this component wires up by hand.
  const listRef = useRef<HTMLUListElement | null>(null)

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

  const checkout = (name: string): Promise<void> => run(async () => {
    const outcome = await window.apiary.gitCheckoutBranch(terminal, name)
    if (!outcome.ok) {
      // Not an error, and not this popover's to solve: hand the conflict up and get out of the
      // way, so the choice is made in a dialog rather than inside a branch list.
      onClose()
      onWorktreeConflict(outcome.conflict)
      return
    }
    onCheckedOut()
    onClose()
  })

  const checkoutRemote = (remoteRef: string): Promise<void> => run(async () => {
    const localName = remoteRef.slice(remoteRef.indexOf('/') + 1)
    await window.apiary.gitCheckoutRemote(terminal, remoteRef, localName)
    onCheckedOut()
    onClose()
  })

  const checkoutDetached = (ref: string): Promise<void> => run(async () => {
    await window.apiary.gitCheckoutDetached(terminal, ref)
    onCheckedOut()
    onClose()
  })

  // A conflicting merge leaves the tree mid-merge on purpose (see branchOps.merge), so `run`'s
  // catch reporting the error in the banner, without either onCheckedOut or onClose, is exactly
  // right: the popup stays open with git's own CONFLICT text in it rather than closing over a repo
  // the user now has to notice is halfway through something.
  const mergeRef = (ref: string): Promise<void> => run(async () => {
    await window.apiary.gitMerge(terminal, ref)
    onCheckedOut()
    onClose()
  })

  /** What a click on a ref row does, given which job this picker is currently doing. */
  const pickRef = (name: string, kind: 'local' | 'remote' | 'tag'): void => {
    if (mode === 'merge') { void mergeRef(name); return }
    if (step.kind === 'pick-base') { setNameDraft(''); setStep({ kind: 'name', from: name }); return }
    if (step.kind === 'pick-detached' || kind === 'tag') { void checkoutDetached(name); return }
    if (kind === 'remote') { void checkoutRemote(name); return }
    void checkout(name)
  }

  const createBranch = (from?: string): Promise<void> => {
    const name = nameDraft.trim()
    if (name === '') return Promise.resolve()
    return run(async () => {
      await window.apiary.gitCreateBranch(terminal, name, from)
      onCheckedOut()
      onClose()
    })
  }

  if (step.kind === 'name') {
    return (
      // UI-25: onto the shared Modal primitive (Escape already worked via UI-13; this adds a
      // labelled role, a Tab trap and focus restore on close). `closeOnBackdropClick` keeps the
      // click-outside-closes behaviour this dialog already had.
      <Modal
        testId="branch-switcher"
        titleId="branch-switcher-title"
        onClose={onClose}
        className="branch-switcher"
        initialFocusSelector='[data-testid="branch-switcher-name-input"]'
        closeOnBackdropClick
      >
        <h2 id="branch-switcher-title" className="visually-hidden">New branch name</h2>
        {errorMessage !== null && (
          <p className="error-banner" data-testid="branch-switcher-error">{errorMessage}</p>
        )}
        <input
          className="search"
          data-testid="branch-switcher-name-input"
          placeholder="Branch name"
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void createBranch(step.from) }}
        />
        <div className="modal-actions">
          <button className="btn" data-testid="branch-switcher-cancel" onClick={() => { setErrorMessage(null); setStep({ kind: 'list' }) }}>Back</button>
          <button className="btn primary" data-testid="branch-switcher-confirm" disabled={busy || nameDraft.trim() === ''} onClick={() => { void createBranch(step.from) }}>
            Create branch
          </button>
        </div>
      </Modal>
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
    // UI-25: onto the shared Modal primitive (Escape already worked via UI-13; this adds a
    // labelled role, a Tab trap and focus restore on close). `closeOnBackdropClick` keeps the
    // click-outside-closes behaviour this dialog already had.
    <Modal
      testId="branch-switcher"
      titleId="branch-switcher-title"
      onClose={onClose}
      wide
      className="branch-switcher"
      initialFocusSelector='[data-testid="branch-switcher-search"]'
      closeOnBackdropClick
    >
      <h2 id="branch-switcher-title" className="visually-hidden">{placeholder}</h2>
      {errorMessage !== null && (
        <p className="error-banner" data-testid="branch-switcher-error">{errorMessage}</p>
      )}
      <input
        className="search"
        data-testid="branch-switcher-search"
        placeholder={placeholder}
        value={query}
        onChange={(e) => { setQuery(e.target.value); setErrorMessage(null) }}
        onKeyDown={(e) => {
          // Same guard the row buttons get from `disabled={busy}`: without it, a checkout
          // already in flight (the modal stays open across its await) lets a second Enter
          // fire a second concurrent gitCheckoutBranch for the same ref.
          if (e.key === 'Enter' && activeMatch !== null && !busy) {
            pickRef(activeMatch.entry.name, activeMatch.kind)
            return
          }
          if (listRef.current !== null) onListKeyDown(e, listRef.current)
        }}
      />

        <ul ref={listRef} className="branch-switcher-list" onKeyDown={(e) => { if (listRef.current !== null) onListKeyDown(e, listRef.current) }}>
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
    </Modal>
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
