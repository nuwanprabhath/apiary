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
    <div className="modal-backdrop">
      <div className="modal" data-testid="move-session-dialog" role="dialog" aria-modal="true">
        <h2>Move this session?</h2>
        <p>
          <strong>{sessionTitle}</strong> will move from
          <br /><code>{fromPath}</code>
          <br />to
          <br /><code>{toPath}</code>
        </p>
        <div className="modal-actions">
          <button data-testid="move-session-cancel" onClick={onCancel}>Cancel</button>
          <button className="primary" data-testid="move-session-confirm" onClick={onConfirm}>Move</button>
        </div>
      </div>
    </div>
  )
}
