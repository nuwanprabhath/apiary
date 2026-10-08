import type { JSX, ReactNode } from 'react'
import { ErrorBoundary } from '../../ui/ErrorBoundary'
import { Modal } from '../../ui/Modal'
import { crashNotice } from '../../ui/errors'
import { useNotifications } from '../../ui/notifications'

/**
 * Confines a dialog's render fault to the dialog (B11, UI-24). `DialogHost` renders its dialogs
 * inside the layout, so one that throws and has no boundary of its own replaces the whole window.
 * The fallback is itself a dialog, so the user can try again or close it: the crash pane the
 * self-wrapping dialogs use would land in the layout grid, not over the window.
 */
export function DialogBoundary({ onClose, children }: { onClose: () => void; children: ReactNode }): JSX.Element {
  const { notify } = useNotifications()
  return (
    <ErrorBoundary
      label="This dialog"
      onError={(thrown, componentStack) => { notify(crashNotice('This dialog', thrown, componentStack)) }}
      fallback={({ message, retry }) => (
        <Modal testId="dialog-crash" titleId="dialog-crash-title" onClose={onClose}>
          <h2 id="dialog-crash-title">This dialog could not be displayed</h2>
          <p className="crash-message" data-testid="dialog-crash-message">{message}</p>
          <div className="modal-actions">
            <button className="btn" data-testid="dialog-crash-retry" onClick={retry}>Try again</button>
            <button className="btn primary" data-testid="dialog-crash-close" onClick={onClose}>Close</button>
          </div>
        </Modal>
      )}
    >
      {children}
    </ErrorBoundary>
  )
}
