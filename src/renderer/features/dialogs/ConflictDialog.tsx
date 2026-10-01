import type { JSX } from 'react'
import type { ResumeConflict } from '@shared/types'
import { ErrorBoundary } from '../../ui/ErrorBoundary'
import { Modal } from '../../ui/Modal'

interface Props {
  conflict: ResumeConflict
  onFork: () => void
  onOpenAnyway: () => void
  onCancel: () => void
}

export function ConflictDialog({ conflict, onFork, onOpenAnyway, onCancel }: Props): JSX.Element {
  return (
    // UI-24: confines a render fault to this dialog instead of the whole window.
    <ErrorBoundary label="This dialog">
      <Modal testId="conflict-dialog" titleId="conflict-dialog-title" onClose={onCancel}>
        <h2 id="conflict-dialog-title">This session is already running</h2>
        <p>
          Another Claude process (pid {conflict.pid}) is holding this session. Opening it again
          means two processes writing the same history.
        </p>
        <p className="muted">
          Forking starts a new session from this point and leaves the original untouched.
        </p>
        <div className="modal-actions">
          <button className="btn" data-testid="conflict-cancel" onClick={onCancel}>Cancel</button>
          <button className="btn" data-testid="conflict-open" onClick={onOpenAnyway}>Open anyway</button>
          <button className="btn primary" data-testid="conflict-fork" onClick={onFork}>Fork</button>
        </div>
      </Modal>
    </ErrorBoundary>
  )
}
