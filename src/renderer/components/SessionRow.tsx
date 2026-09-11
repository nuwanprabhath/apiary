import type { SessionNode } from '@shared/types'
import { PinIcon, SplitIcon, TrashIcon } from './icons'

/** Days since a session was last touched, in the compact form the sidebar has room for. */
/** An absolute timestamp for the tooltip — "8d" is for the row, where space is the constraint. */
function fullTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export function relativeTime(ms: number | null): string {
  if (ms === null) return ''
  const days = Math.floor((Date.now() - ms) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return '1d'
  return String(days) + 'd'
}

interface Props {
  session: SessionNode
  selected: boolean
  pinned: boolean
  onSelect: (session: SessionNode) => void
  onSplit: (session: SessionNode) => void
  onDelete: (session: SessionNode) => void
  onTogglePin: (session: SessionNode) => void
}

/**
 * One session in the sidebar — used both inside its folder in the tree and, unchanged, in the
 * pinned section above it, so a pinned session looks and behaves exactly like the row it was
 * pinned from.
 *
 * The age and the row's buttons deliberately occupy the *same* space at the right-hand end: the
 * age is what you want while scanning the list, the buttons only once you have settled on a row,
 * and swapping one for the other on hover means neither has to give up width to the other (see
 * `.session-row-wrap:hover .session-time` in styles.css). The buttons are siblings of the row
 * rather than children of it because a <button> cannot contain another interactive element.
 */
export function SessionRow({
  session, selected, pinned, onSelect, onSplit, onDelete, onTogglePin,
}: Props): JSX.Element {
  return (
    <div className="session-row-wrap" data-pinned={pinned} data-session-id={session.sessionId}>
      <button
        className="session-row"
        data-testid="session-item"
        data-selected={selected}
        data-live={session.isLive}
        onClick={() => onSelect(session)}
        // Everything needed to tell two similarly-named sessions apart, which the row itself has
        // no width for: where it ran, on what branch, and when it was last touched. The title is
        // repeated because the row ellipsizes it long before the tooltip would.
        title={[
          session.title,
          session.cwd,
          session.gitBranch === null ? null : `branch: ${session.gitBranch}`,
          session.lastActiveAtMs === null ? null : `last active: ${fullTime(session.lastActiveAtMs)}`,
        ].filter((line): line is string => line !== null).join('\n')}
      >
        {session.isLive && <span className="live-dot" aria-label="running" />}
        <span className="session-title">{session.title}</span>
        {!session.cwdExists && <span className="missing">folder gone</span>}
        <span className="session-time" data-testid="session-time">{relativeTime(session.lastActiveAtMs)}</span>
      </button>
      <button
        className="row-action pin-session-button"
        data-testid="pin-session-button"
        data-pinned={pinned}
        title={pinned ? 'Unpin this session' : 'Pin this session'}
        aria-label={`${pinned ? 'Unpin' : 'Pin'} session ${session.title}`}
        aria-pressed={pinned}
        onClick={(e) => { e.stopPropagation(); onTogglePin(session) }}
      >
        <PinIcon filled={pinned} />
      </button>
      <button
        className="row-action split-session-button"
        data-testid="split-session-button"
        title="Open to the side"
        aria-label={`Open session ${session.title} to the side`}
        onClick={(e) => { e.stopPropagation(); onSplit(session) }}
      >
        <SplitIcon />
      </button>
      <button
        className="row-action delete-session-button"
        data-testid="delete-session-button"
        title="Remove this session"
        aria-label={`Remove session ${session.title}`}
        onClick={(e) => { e.stopPropagation(); onDelete(session) }}
      >
        <TrashIcon />
      </button>
    </div>
  )
}
