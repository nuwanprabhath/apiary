import type { ResumeConflict } from '@shared/types'

interface Props {
  conflict: ResumeConflict
  onFork: () => void
  onOpenAnyway: () => void
  onCancel: () => void
}

export function ConflictDialog({ conflict, onFork, onOpenAnyway, onCancel }: Props): JSX.Element {
  return (
    <div className="modal-backdrop">
      <div className="modal" data-testid="conflict-dialog" role="dialog" aria-modal="true">
        <h2>This session is already running</h2>
        <p>
          Another Claude process (pid {conflict.pid}) is holding this session. Opening it again
          means two processes writing the same history.
        </p>
        <p className="muted">
          Forking starts a new session from this point and leaves the original untouched.
        </p>
        <div className="modal-actions">
          <button data-testid="conflict-cancel" onClick={onCancel}>Cancel</button>
          <button data-testid="conflict-open" onClick={onOpenAnyway}>Open anyway</button>
          <button className="primary" data-testid="conflict-fork" onClick={onFork}>Fork</button>
        </div>
      </div>
    </div>
  )
}
