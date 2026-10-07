import { type JSX, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { WorktreeConflict } from '@shared/types'
import { ErrorBoundary } from '../../ui/ErrorBoundary'
import { Modal } from '../../ui/Modal'

interface Props {
  conflict: WorktreeConflict
  busy: boolean
  onPull: () => void
  onOpenSession: () => void
  /** Switches the worktree holding the branch to `otherTo`, then checks the branch out here. */
  onMoveOther: (otherTo: string) => void
  onCancel: () => void
}

/**
 * What to do about a branch that is already checked out somewhere else.
 *
 * Git refuses this checkout, and on a repository with a worktree per ticket that refusal is the
 * normal answer rather than a failure — the branch exists and is up the road. The things anyone
 * wants at that moment are the buttons here: bring it up to date where it actually lives, go and
 * work in it, or have it here after all by moving that worktree to another branch (or swapping
 * with this one) in the same step. Before this, the app printed git's sentence ("fatal:
 * 'dev/1.0.12' is already used by worktree at '/…'") and left the user to go and find that
 * directory by hand, which is the slow part.
 *
 * The path is shown but never sent back: every action names the *branch*, and the main process
 * re-derives the worktree from the repository each time (see `requireWorktreeFor`).
 */
export function WorktreeConflictDialog(
  { conflict, busy, onPull, onOpenSession, onMoveOther, onCancel }: Props,
): JSX.Element {
  const hasChoices = conflict.choices.length > 0
  return (
    // UI-24: confines a render fault to this dialog instead of the whole window.
    <ErrorBoundary label="This dialog">
      <Modal
        testId="worktree-conflict-dialog"
        titleId="worktree-conflict-title"
        onClose={onCancel}
        // With a list to search, typing is what comes next; without one, the buttons are all.
        {...(hasChoices ? { initialFocusSelector: '[data-testid="worktree-conflict-search"]' } : {})}
      >
        <h2 id="worktree-conflict-title">{conflict.branch} is checked out in another worktree</h2>
        <p>
          Git will not check it out twice. It is in{' '}
          <strong data-testid="worktree-conflict-label">{conflict.label}</strong>.
        </p>
        <p className="muted" data-testid="worktree-conflict-path">{conflict.worktreePath}</p>
        {hasChoices && <OtherBranchPicker conflict={conflict} busy={busy} onMoveOther={onMoveOther} />}
        <div className="modal-actions">
          <button className="btn" data-testid="worktree-conflict-cancel" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button className="btn" data-testid="worktree-conflict-session" disabled={busy} onClick={onOpenSession}>
            New session there
          </button>
          <button
            className="btn primary"
            data-testid="worktree-conflict-pull"
            disabled={busy}
            onClick={onPull}
          >
            {busy ? 'Working…' : 'Pull it there'}
          </button>
        </div>
      </Modal>
    </ErrorBoundary>
  )
}

/**
 * Which branch the other worktree moves to: a search box over a short list, as the branch picker
 * has, since a repository with a worktree per ticket has dozens of branches and a native dropdown
 * of them can only be scrolled. The highlighted row is the choice; typing keeps it on a row still
 * shown, the arrow keys move it, Enter or "Switch both" acts on it, and a double-click acts at once.
 * This folder's own branch comes first, as a swap.
 */
function OtherBranchPicker(
  { conflict, busy, onMoveOther }: { conflict: WorktreeConflict; busy: boolean; onMoveOther: (otherTo: string) => void },
): JSX.Element {
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState(conflict.choices[0] ?? '')
  const listRef = useRef<HTMLUListElement | null>(null)

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q === '' ? conflict.choices : conflict.choices.filter((b) => b.toLowerCase().includes(q))
  }, [conflict.choices, query])
  // The choice is always a row on screen, so Enter never acts on one the filter has hidden.
  const chosen = shown.includes(picked) ? picked : (shown[0] ?? null)

  // Held at the height it opened with: the dialog is centred, so a list shrinking as you type
  // moved the search box out from under the cursor.
  useLayoutEffect(() => {
    const list = listRef.current
    if (list !== null) list.style.minHeight = `${String(list.offsetHeight)}px`
  }, [])

  useEffect(() => {
    if (chosen === null) return
    listRef.current?.querySelector(`[data-branch="${CSS.escape(chosen)}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [chosen])

  const act = (): void => { if (chosen !== null && !busy) onMoveOther(chosen) }
  const step = (by: number): void => {
    if (shown.length === 0) return
    const at = chosen === null ? -1 : shown.indexOf(chosen)
    setPicked(shown[Math.min(shown.length - 1, Math.max(0, at + by))])
  }

  return (
    <div className="worktree-conflict-move">
      <label htmlFor="worktree-conflict-search">To have it here, switch {conflict.label} to</label>
      <input
        id="worktree-conflict-search"
        className="search"
        data-testid="worktree-conflict-search"
        placeholder={`Search ${String(conflict.choices.length)} branches`}
        value={query}
        disabled={busy}
        onChange={(e) => { setQuery(e.target.value) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); step(1) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); step(-1) }
          else if (e.key === 'Enter') { e.preventDefault(); act() }
        }}
        role="combobox"
        aria-expanded="true"
        aria-controls="worktree-conflict-choices"
        aria-activedescendant={chosen === null ? undefined : `worktree-conflict-choice-${String(shown.indexOf(chosen))}`}
      />
      <ul
        id="worktree-conflict-choices"
        ref={listRef}
        className="branch-switcher-list worktree-conflict-choices"
        role="listbox"
        aria-label={`Branches for ${conflict.label}`}
      >
        {shown.length === 0 && <li className="empty" data-testid="worktree-conflict-none">No branch matches</li>}
        {shown.map((b, i) => (
          <li key={b} role="presentation">
            <button
              id={`worktree-conflict-choice-${String(i)}`}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={b === chosen}
              className="branch-switcher-row worktree-conflict-choice"
              data-testid="worktree-conflict-choice"
              data-branch={b}
              data-active={b === chosen}
              disabled={busy}
              onClick={() => { setPicked(b) }}
              onDoubleClick={() => { if (!busy) onMoveOther(b) }}
            >
              <span className="branch-switcher-row-name">{b}</span>
              {b === conflict.current && <span className="worktree-conflict-swap">swap with this one</span>}
            </button>
          </li>
        ))}
      </ul>
      <div className="worktree-conflict-move-row">
        {/* One line per worktree, wrapping rather than clipped: the end of a long branch name is
            usually the part that tells two apart. */}
        <div className="muted worktree-conflict-summary" data-testid="worktree-conflict-summary">
          {chosen === null
            ? <span>Pick a branch for it</span>
            : (
                <>
                  <span>{conflict.label} → <strong>{chosen}</strong></span>
                  <span>here → <strong>{conflict.branch}</strong></span>
                </>
              )}
        </div>
        <button
          className="btn"
          data-testid="worktree-conflict-move"
          disabled={busy || chosen === null}
          onClick={act}
        >
          Switch both
        </button>
      </div>
    </div>
  )
}
