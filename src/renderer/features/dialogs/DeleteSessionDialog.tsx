import type { JSX } from 'react'
import { ErrorBoundary } from '../../ui/ErrorBoundary'
import { Modal } from '../../ui/Modal'
interface Props {
  title: string
  onCancel: () => void
  onConfirm: () => void
}

export function DeleteSessionDialog({ title, onCancel, onConfirm }: Props): JSX.Element {
  return (
    // A render crash here used to fall through to the root boundary, which replaces the whole
    // window — panes and terminals included — for what should be confined to one confirm dialog
    // (UI-24). Every other dialog below wraps itself the same way, for the same reason.
    <ErrorBoundary label="This dialog">
      <Modal
        testId="delete-session-dialog"
        titleId="delete-session-title"
        onClose={onCancel}
        // A destructive confirm defaults to the safe answer (UI-25): landing on "Remove" would
        // make a stray Enter — muscle memory from dismissing the last thing that popped up — delete
        // the session instead of doing nothing.
        initialFocusSelector='[data-testid="delete-session-cancel"]'
      >
        <h2 id="delete-session-title">Remove this session?</h2>
        <p>
          <strong>{title}</strong> will no longer appear in Apiary. The conversation itself is
          not deleted — it stays on disk in <code>~/.claude/projects</code>, and this session can
          be brought back later from <strong>File &gt; Import Claude Sessions</strong>.
        </p>
        <div className="modal-actions">
          <button className="btn" data-testid="delete-session-cancel" onClick={onCancel}>Cancel</button>
          <button className="btn danger" data-testid="delete-session-confirm" onClick={onConfirm}>Remove</button>
        </div>
      </Modal>
    </ErrorBoundary>
  )
}
