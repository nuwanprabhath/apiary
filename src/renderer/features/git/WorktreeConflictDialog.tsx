import type { JSX } from 'react'
import type { WorktreeConflict } from '@shared/types'
import { ErrorBoundary } from '../../ui/ErrorBoundary'
import { Modal } from '../../ui/Modal'

interface Props {
  conflict: WorktreeConflict
  busy: boolean
  onPull: () => void
  onOpenSession: () => void
  onCancel: () => void
}

/**
 * What to do about a branch that is already checked out somewhere else.
 *
 * Git refuses this checkout, and on a repository with a worktree per ticket that refusal is the
 * normal answer rather than a failure — the branch exists and is up the road. The two things
 * anyone wants at that moment are the two buttons here: bring it up to date where it actually
 * lives, or go and work in it. Before this, the app printed git's sentence ("fatal: 'dev/1.0.12'
 * is already used by worktree at '/…'") and left the user to go and find that directory by hand,
 * which is the slow part.
 *
 * The path is shown but never sent back: both actions name the *branch*, and the main process
 * re-derives the worktree from the repository each time (see `requireWorktreeFor`).
 */
export function WorktreeConflictDialog(
  { conflict, busy, onPull, onOpenSession, onCancel }: Props,
): JSX.Element {
  return (
    // UI-24: confines a render fault to this dialog instead of the whole window.
    <ErrorBoundary label="This dialog">
      <Modal testId="worktree-conflict-dialog" titleId="worktree-conflict-title" onClose={onCancel}>
        <h2 id="worktree-conflict-title">{conflict.branch} is checked out in another worktree</h2>
        <p>
          Git will not check it out twice. It is in{' '}
          <strong data-testid="worktree-conflict-label">{conflict.label}</strong>.
        </p>
        <p className="muted" data-testid="worktree-conflict-path">{conflict.worktreePath}</p>
        <div className="modal-actions">
          <button data-testid="worktree-conflict-cancel" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button data-testid="worktree-conflict-session" disabled={busy} onClick={onOpenSession}>
            New session there
          </button>
          <button
            className="primary"
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
