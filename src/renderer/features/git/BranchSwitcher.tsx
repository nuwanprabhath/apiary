import { type JSX, useEffect, useMemo, useRef, useState } from 'react'
import type { GitRefEntry, GitRefs, WorktreeConflict } from '@shared/types'
import type { GitTarget } from '@shared/domain/git'
import { exactRefMatch } from './branchSelection'
import { BRANCH_ROW_SELECTOR } from './branchRows'
import { BranchNameStep } from './BranchNameStep'
import { BranchActions, BranchSection } from './BranchSection'
import { useBranchActions } from './useBranchActions'
import { Modal } from '../../ui/Modal'
import { useRovingList } from '../../ui/useRovingList'
import * as git from '../../state/git'

interface Props {
  /** A pane's session, or a sidebar folder (its menu's "Change branch…"). Keep it stable: the ref
   *  list is fetched again whenever it changes. */
  terminal: GitTarget
  onClose: () => void
  onCheckedOut: () => void
  onError: (message: string) => void
  /** Raised instead of an error when the branch is already checked out in another worktree. */
  onWorktreeConflict: (conflict: WorktreeConflict) => void
  /** What picking a ref does: 'checkout', or 'merge' to choose what to merge into the current branch. */
  mode?: 'checkout' | 'merge'
  /** Current branch name, only used to say what a merge would be merging into. */
  currentBranch?: string | null
  /** Opens straight into naming a new branch, for the menu's "Create Branch..." command. */
  startAt?: 'list' | 'name'
  /** A one-line result to show (the pull button's "Pulled 3 commits into main."). */
  onNotice?: (message: string) => void
  /** A branch moved (the pull button): the toolbar's ahead/behind is out of date. */
  onBranchUpdated?: () => void
  /** Said above the search box; a sidebar folder's picker says which folder it changes. */
  heading?: string
}

type Step =
  | { kind: 'list' }
  | { kind: 'name'; from?: string }
  | { kind: 'pick-base' }
  | { kind: 'pick-detached' }

function matches(entry: GitRefEntry, query: string): boolean {
  return query === '' || entry.name.toLowerCase().includes(query)
}

function filterRefs(refs: GitRefs | null, q: string): { local: GitRefEntry[]; remote: GitRefEntry[]; tags: GitRefEntry[] } {
  if (refs === null) return { local: [], remote: [], tags: [] }
  return {
    local: refs.local.filter((r) => matches(r, q)),
    remote: refs.remote.filter((r) => matches(r, q)),
    tags: refs.tags.filter((r) => matches(r, q)),
  }
}

const pickingBaseNow = (s: Step): boolean => s.kind === 'pick-base' || s.kind === 'pick-detached'

export function BranchSwitcher({
  terminal, onClose, onCheckedOut, onError, onWorktreeConflict, mode = 'checkout',
  currentBranch = null,
  startAt = 'list',
  onNotice,
  onBranchUpdated,
  heading,
}: Props): JSX.Element {
  const [refs, setRefs] = useState<GitRefs | null>(null)
  const [query, setQuery] = useState('')
  const [step, setStep] = useState<Step>(startAt === 'name' ? { kind: 'name' } : { kind: 'list' })
  const [nameDraft, setNameDraft] = useState('')
  const {
    busy, errorMessage, setErrorMessage, updateBranch, checkout, checkoutRemote, checkoutDetached, mergeRef, createBranch,
  } = useBranchActions({ terminal, onClose, onCheckedOut, onWorktreeConflict, onNotice, onBranchUpdated, setRefs })

  // `onError` is a fresh function on every parent render (every git-status poll), so it cannot go
  // in the fetch effect's deps without refetching the refs each time.
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  useEffect(() => {
    let cancelled = false
    void git.gitRefs(terminal)
      .then((r) => { if (!cancelled) setRefs(r) })
      .catch((e: Error) => { if (!cancelled) onErrorRef.current(e.message) })
    return () => { cancelled = true }
    // Keyed on [terminal] only: the list is filtered client-side, so `query` need not refetch. If
    // the active tab changes under an open modal, it re-lists for the new terminal.
  }, [terminal])

  const listRef = useRef<HTMLUListElement | null>(null)
  const rows = useRovingList(listRef, { itemSelector: BRANCH_ROW_SELECTOR })

  const q = query.trim().toLowerCase()
  const filtered = useMemo(() => filterRefs(refs, q), [refs, q])

  const activeMatch = mode === 'checkout' && !pickingBaseNow(step)
    ? exactRefMatch(refs ?? { local: [], remote: [] }, query.trim())
    : null

  const pickRef = (name: string, kind: 'local' | 'remote' | 'tag'): void => {
    if (mode === 'merge') { void mergeRef(name); return }
    if (step.kind === 'pick-base') { setNameDraft(''); setStep({ kind: 'name', from: name }); return }
    if (step.kind === 'pick-detached' || kind === 'tag') { void checkoutDetached(name); return }
    if (kind === 'remote') { void checkoutRemote(name); return }
    void checkout(name)
  }

  if (step.kind === 'name') {
    const from = step.from
    return (
      <BranchNameStep
        nameDraft={nameDraft}
        busy={busy}
        errorMessage={errorMessage}
        onNameDraft={setNameDraft}
        onCreate={() => { void createBranch(nameDraft.trim(), from) }}
        onBack={() => { setErrorMessage(null); setStep({ kind: 'list' }) }}
        onClose={onClose}
      />
    )
  }

  const pickingBase = pickingBaseNow(step)
  const showActions = !pickingBase && mode === 'checkout'
  const placeholder = mode === 'merge'
    ? `Select a branch to merge into ${currentBranch ?? 'HEAD'}`
    : pickingBase ? 'Select a ref to branch from' : 'Select a branch or tag to checkout'

  return (
    <Modal
      testId="branch-switcher"
      titleId="branch-switcher-title"
      onClose={onClose}
      wide
      className="branch-switcher"
      initialFocusSelector='[data-testid="branch-switcher-search"]'
      closeOnBackdropClick
    >
      {heading !== undefined
        ? <h2 id="branch-switcher-title" className="new-worktree-title" data-testid="branch-switcher-heading">{heading}</h2>
        : <h2 id="branch-switcher-title" className="visually-hidden">{placeholder}</h2>}
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
          rows.onKeyDown(e)
        }}
      />

      <ul ref={listRef} className="branch-switcher-list" onKeyDown={rows.onKeyDown}>
        {showActions && (
          <BranchActions
            onCreate={() => { setErrorMessage(null); setNameDraft(''); setStep({ kind: 'name' }) }}
            onCreateFrom={() => { setErrorMessage(null); setStep({ kind: 'pick-base' }) }}
            onDetached={() => { setErrorMessage(null); setStep({ kind: 'pick-detached' }) }}
          />
        )}

        {refs === null && <li className="empty">Loading…</li>}

        {refs !== null && (
          <>
            <BranchSection
              title="branches" testId="branch-switcher-branch-row" rows={filtered.local} busy={busy}
              activeName={activeMatch?.kind === 'local' ? activeMatch.entry.name : null}
              onPick={(r) => { pickRef(r.name, 'local') }}
              onUpdate={updateBranch}
            />
            <BranchSection
              title="remote branches" testId="branch-switcher-remote-row" rows={filtered.remote} busy={busy}
              activeName={activeMatch?.kind === 'remote' ? activeMatch.entry.name : null}
              onPick={(r) => { pickRef(r.name, 'remote') }}
            />
            <BranchSection
              title="tags" testId="branch-switcher-tag-row" rows={filtered.tags} busy={busy}
              activeName={null}
              onPick={(r) => { pickRef(r.name, 'tag') }}
            />
          </>
        )}
      </ul>
    </Modal>
  )
}
