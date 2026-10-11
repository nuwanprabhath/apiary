import type { JSX, ReactNode } from 'react'
import type { SessionNode } from '@shared/types'
import { CloseIcon, NoteIcon, PinIcon, TrashIcon } from '../../ui/icons'

/**
 * The row's button strip (note, pin, split, delete, dismiss): siblings of the row's own button
 * because a <button> cannot contain another interactive element.
 */
export function SessionRowActions({
  session, pinned, hasNote, splitButton, onDelete, onTogglePin, onEditNote, onDismiss,
}: {
  session: SessionNode
  pinned: boolean
  hasNote: boolean
  /** The "open to the side" button, placed between pin and delete. */
  splitButton: ReactNode
  onDelete: (session: SessionNode) => void
  onTogglePin: (session: SessionNode) => void
  onEditNote: (session: SessionNode) => void
  onDismiss?: (session: SessionNode) => void
}): JSX.Element {
  return (
    <>
      <button
        className="row-action note-session-button"
        data-testid="note-session-button"
        data-has-note={hasNote}
        title={hasNote ? 'Edit this session’s note' : 'Add a note to this session'}
        aria-label={`${hasNote ? 'Edit' : 'Add'} note for session ${session.title}`}
        // UI-27 step 1: row-action buttons are not Tab stops (with 500 sessions that would be
        // 2000+ of them); the row's own context menu (Shift+F10 / the Menu key, wired at the
        // tree's root) offers the same actions.
        tabIndex={-1}
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
        tabIndex={-1}
        onClick={(e) => { e.stopPropagation(); onTogglePin(session) }}
      >
        <PinIcon filled={pinned} />
      </button>
      {splitButton}
      <button
        className="row-action delete-session-button"
        data-testid="delete-session-button"
        title="Remove this session"
        aria-label={`Remove session ${session.title}`}
        tabIndex={-1}
        onClick={(e) => { e.stopPropagation(); onDelete(session) }}
      >
        <TrashIcon />
      </button>
      {onDismiss !== undefined && (
        <button
          className="row-action"
          data-testid="recent-dismiss-button"
          title="Dismiss from Recent"
          aria-label={`Dismiss ${session.title} from Recent`}
          tabIndex={-1}
          onClick={(e) => { e.stopPropagation(); onDismiss(session) }}
        >
          <CloseIcon />
        </button>
      )}
    </>
  )
}
