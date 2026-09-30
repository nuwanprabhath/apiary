import type { JSX } from 'react'
import { ErrorBoundary } from '../../ui/ErrorBoundary'
import { Modal } from '../../ui/Modal'

interface Props {
  onKeepRunning: () => void
  onSuspend: () => void
}

/**
 * Asked when Ctrl+Z is pressed in a Claude Code terminal.
 *
 * Ctrl+Z is "undo" in every text box people type into, and Claude's prompt looks like one — so it
 * is pressed by accident, and Claude Code treats it as a suspend: it leaves the screen and waits
 * for a `fg` that this terminal has no shell to give. The safe answer is focused, so an Enter out
 * of habit keeps Claude running; Claude's own undo is Ctrl+_ (Ctrl+Shift+-), said here because
 * that is what the person was reaching for.
 */
export function SuspendConfirmDialog({ onKeepRunning, onSuspend }: Props): JSX.Element {
  return (
    <ErrorBoundary label="This dialog">
      <Modal
        testId="suspend-confirm-dialog"
        titleId="suspend-confirm-title"
        onClose={onKeepRunning}
        initialFocusSelector='[data-testid="suspend-confirm-cancel"]'
      >
        <h2 id="suspend-confirm-title">Suspend Claude Code?</h2>
        <p>
          Ctrl+Z suspends Claude Code rather than undoing your typing. To undo input in Claude's
          prompt, use <kbd>Ctrl</kbd>+<kbd>_</kbd>.
        </p>
        <p>If you do suspend it, a Resume bar brings it back with your draft intact.</p>
        <div className="modal-actions">
          <button className="btn" data-testid="suspend-confirm-cancel" onClick={onKeepRunning}>
            Don&apos;t suspend
          </button>
          <button className="btn danger" data-testid="suspend-confirm-suspend" onClick={onSuspend}>
            Suspend
          </button>
        </div>
      </Modal>
    </ErrorBoundary>
  )
}
