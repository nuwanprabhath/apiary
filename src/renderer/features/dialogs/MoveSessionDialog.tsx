import type { JSX } from 'react'
import { ErrorBoundary } from '../../ui/ErrorBoundary'
import { Modal } from '../../ui/Modal'
interface Props {
  sessionTitle: string
  fromPath: string
  toPath: string
  onCancel: () => void
  onConfirm: () => void
}

/**
 * Confirms a drag-to-move before it happens. A move renames the transcript's file and points the
 * store at its new project — worth a confirmation rather than a silent drop, since dragging a row
 * a few pixels too far onto the wrong worktree would otherwise be effectively irreversible.
 */
export function MoveSessionDialog({ sessionTitle, fromPath, toPath, onCancel, onConfirm }: Props): JSX.Element {
  return (
    // UI-24: confines a render fault to this dialog instead of the whole window.
    <ErrorBoundary label="This dialog">
      <Modal testId="move-session-dialog" titleId="move-session-title" onClose={onCancel}>
        <h2 id="move-session-title">Move this session?</h2>
        <p>
          <strong>{sessionTitle}</strong> will move from
          <br /><code>{fromPath}</code>
          <br />to
          <br /><code>{toPath}</code>
        </p>
        <div className="modal-actions">
          <button className="btn" data-testid="move-session-cancel" onClick={onCancel}>Cancel</button>
          <button className="btn primary" data-testid="move-session-confirm" onClick={onConfirm}>Move</button>
        </div>
      </Modal>
    </ErrorBoundary>
  )
}
