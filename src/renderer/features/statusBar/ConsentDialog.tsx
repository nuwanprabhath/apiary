import type { JSX } from 'react'
import type { ConsentPrompt } from '@shared/domain/statusBar'
import { ErrorBoundary } from '../../ui/ErrorBoundary'
import { Modal } from '../../ui/Modal'

interface Props {
  prompt: ConsentPrompt
  onAnswer: (allow: boolean) => void
  /** Escape or a click outside: not an answer, so the question stays on the bar. */
  onLater: () => void
}

/**
 * The one-time question a status-bar plugin asks before it touches something of the user's, drawn
 * from the plugin's own words. Focus starts on the refusal: this dialog appears on its own, and an
 * Enter meant for something else must never be the thing that grants access.
 */
export function ConsentDialog({ prompt, onAnswer, onLater }: Props): JSX.Element {
  return (
    <ErrorBoundary label="This dialog">
      <Modal
        testId="status-consent" titleId="status-consent-title" onClose={onLater}
        initialFocusSelector='[data-testid="status-consent-deny"]'
      >
        <h2 id="status-consent-title">{prompt.title}</h2>
        {prompt.lines.map((line) => <p key={line}>{line}</p>)}
        <div className="modal-actions">
          <button type="button" className="btn" data-testid="status-consent-deny" onClick={() => { onAnswer(false) }}>{prompt.deny}</button>
          <button type="button" className="btn primary" data-testid="status-consent-allow" onClick={() => { onAnswer(true) }}>{prompt.allow}</button>
        </div>
      </Modal>
    </ErrorBoundary>
  )
}
