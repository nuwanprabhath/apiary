import type { PtyId } from '@shared/domain/ids'
import type { JSX } from 'react'
import { CloseIcon } from '../../ui/icons'

/** A new-session pty still awaiting its first JSONL. Listed so a pending session other than the
 *  one currently shown can still be reached and switched back to, rather than being silently
 *  unreachable while it resolves in the background. */
export interface PendingSessionSummary {
  ptyId: PtyId
  label: string
  cwd: string
}

/**
 * Claude sessions started here that Claude has not named yet: it writes a session — and its title —
 * only once there is a first message, so until then all there is to show is the folder. Only the
 * ones with no tab in any window are listed (an open one is in Active); they used to sit here
 * unlabelled, which read as mystery rows.
 */
export function PendingSection({ pending, onSelect, onStop }: {
  pending: PendingSessionSummary[]
  /** Switches the main pane to a pending session's terminal. */
  onSelect: (ptyId: PtyId) => void
  /** Ends a pending session's Claude — the row's stop button. */
  onStop?: (ptyId: PtyId) => void
}): JSX.Element {
  return (
    <section className="pending-section" data-testid="pending-section">
      <div
        className="pinned-header pending-header"
        title="Claude sessions started here that are not showing in any window. Claude names a session once it has a first message."
      >
        <span className="pinned-label">Unnamed, running</span>
        <span className="pinned-count">{pending.length}</span>
      </div>
      <ul className="pending-list" data-testid="pending-list">
        {pending.map((p) => (
          <li key={p.ptyId} className="session-row-wrap">
            <button
              className="session-row pending-row"
              data-testid="pending-session-item"
              onClick={() => onSelect(p.ptyId)}
              title={p.cwd}
            >
              <span className="live-dot" aria-label="running" />
              <span className="session-title">New session &middot; {p.label}</span>
            </button>
            {onStop !== undefined && (
              <button
                className="row-action pending-stop"
                data-testid="pending-stop"
                title="Stop this Claude"
                aria-label={`Stop new session in ${p.label}`}
                onClick={() => onStop(p.ptyId)}
              >
                <CloseIcon />
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
