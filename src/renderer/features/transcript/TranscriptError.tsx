import type { JSX } from 'react'
import type { DescribedError } from '../../ui/errors'

/** The load failed. Shown in place rather than as a notification: the pane has nothing else to
 *  display, and a toast over an empty pane would leave the user staring at a blank area once it
 *  was dismissed. The failure still reads as a sentence, with the raw text behind a disclosure. */
export function TranscriptError({ error, onRetry }: { error: DescribedError, onRetry: () => void }): JSX.Element {
  return (
    <div className="transcript-error" data-testid="transcript-error">
      <p className="crash-message">{error.message}</p>
      {error.detail !== null && (
        <details className="crash-detail">
          <summary>Technical details</summary>
          <pre>{error.detail}</pre>
        </details>
      )}
      <div className="crash-actions">
        <button className="btn primary" data-testid="transcript-retry" onClick={onRetry}>
          Try again
        </button>
      </div>
    </div>
  )
}
