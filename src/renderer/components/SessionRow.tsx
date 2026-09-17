import type { SessionNode } from '@shared/types'
import { NoteIcon, PinIcon, SplitIcon, TrashIcon } from './icons'
import { HoverCard } from './HoverCard'
import { useHoverCard } from './useHoverCard'

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
  /** Opens the note editor for this session. */
  onEditNote: (session: SessionNode) => void
  /** Right-click. The menu itself belongs to the sidebar, which is the only thing that can
   *  position one over the whole pane rather than inside a clipped, scrolling row. */
  onMenu?: (session: SessionNode, x: number, y: number) => void
  /**
   * The branch the session's folder is on *now*, from the scan — the same value the session bar
   * shows. Distinct from `session.gitBranch`, which is the branch recorded in the JSONL at the
   * time the session ran and can be months out of date.
   */
  folderBranch?: string | null
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
  session, selected, pinned, onSelect, onSplit, onDelete, onTogglePin, onEditNote, onMenu,
  folderBranch,
}: Props): JSX.Element {
  const hasNote = session.note !== null && session.note !== ''
  const { anchor: cardAnchor, ref: wrapRef, arm, keepOpen, scheduleClose, hideNow } =
    useHoverCard<HTMLDivElement>()

  return (
    <div
      className="session-row-wrap"
      data-pinned={pinned}
      data-session-id={session.sessionId}
      ref={wrapRef}
      onContextMenu={(e) => {
        if (onMenu === undefined) return
        e.preventDefault()
        // The hover card would otherwise sit over the menu that was just asked for.
        hideNow()
        onMenu(session, e.clientX, e.clientY)
      }}
      onMouseEnter={arm}
      onMouseLeave={scheduleClose}
      // Any click hides it: the card is for deciding which row you want, and it has no business
      // sitting over the session you just opened.
      onMouseDown={hideNow}
    >
      {cardAnchor !== null && (
        <HoverCard
          anchor={cardAnchor}
          title={session.title}
          path={session.cwd}
          branch={folderBranch ?? session.gitBranch}
          /*
           * Only when it differs from where the folder is now. Reported as a contradiction: the
           * card said `dev/1.0.12` while the bar under the session said `dev/1.0.11`, both
           * labelled "Branch". They were two different facts — the branch the session was recorded
           * on, and the branch its worktree is checked out to today — so the card now leads with
           * the live one and names the other for what it is.
           */
          recordedBranch={
            folderBranch !== undefined && folderBranch !== null
            && session.gitBranch !== null && session.gitBranch !== folderBranch
              ? session.gitBranch
              : null
          }
          note={session.note}
          lastActive={session.lastActiveAtMs === null ? null : fullTime(session.lastActiveAtMs)}
          missing={!session.cwdExists}
          onPointerEnter={keepOpen}
          onPointerLeave={scheduleClose}
        />
      )}
      <button
        className="session-row"
        data-testid="session-item"
        data-selected={selected}
        data-live={session.isLive}
        onClick={() => onSelect(session)}
      >
        {session.isLive && <span className="live-dot" aria-label="running" />}
        <span className="session-title">{session.title}</span>
        {hasNote && (
          // Marked in the row itself, not only in the actions: which sessions you have annotated
          // is worth knowing while scanning the list, and the actions only appear on hover.
          <span className="session-note-mark" data-testid="session-note-mark" aria-label="has a note">
            <NoteIcon filled />
          </span>
        )}
        {!session.cwdExists && <span className="missing">folder gone</span>}
        <span className="session-time" data-testid="session-time">{relativeTime(session.lastActiveAtMs)}</span>
      </button>
      <button
        className="row-action note-session-button"
        data-testid="note-session-button"
        data-has-note={hasNote}
        title={hasNote ? 'Edit this session\u2019s note' : 'Add a note to this session'}
        aria-label={`${hasNote ? 'Edit' : 'Add'} note for session ${session.title}`}
        onClick={(e) => { e.stopPropagation(); onEditNote(session) }}
      >
        <NoteIcon filled={hasNote} />
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
