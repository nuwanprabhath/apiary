interface Props {
  title: string
  onCancel: () => void
  onConfirm: () => void
}

export function DeleteSessionDialog({ title, onCancel, onConfirm }: Props): JSX.Element {
  return (
    <div className="modal-backdrop">
      <div className="modal" data-testid="delete-session-dialog" role="dialog" aria-modal="true">
        <h2>Remove this session?</h2>
        <p>
          <strong>{title}</strong> will no longer appear in Apiary. The conversation itself is
          not deleted — it stays on disk in <code>~/.claude/projects</code>, and this session can
          be brought back later from <strong>File &gt; Import Claude Sessions</strong>.
        </p>
        <div className="modal-actions">
          <button data-testid="delete-session-cancel" onClick={onCancel}>Cancel</button>
          <button className="danger" data-testid="delete-session-confirm" onClick={onConfirm}>Remove</button>
        </div>
      </div>
    </div>
  )
}
