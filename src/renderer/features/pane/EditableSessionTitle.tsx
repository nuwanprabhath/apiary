import { type JSX, useEffect, useState } from 'react'
import { RenameIcon } from '../../ui/icons'
import { focusAskedFor } from '../../ui/focusUnlessTyping'

interface Props {
  title: string
  onRename: (title: string) => void
}

/**
 * The session header's title, editable in place: hover reveals a pencil button that swaps the
 * heading for a text input. Enter or blur commits, Escape cancels. An empty submission reverts
 * rather than clearing the title; `onRename('')` still means "back to the auto-derived title" for
 * a caller that wants it.
 */
export function EditableSessionTitle({ title, onRename }: Props): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)

  // A later edit starts from the current title, not one left over from another session.
  useEffect(() => { if (!editing) setDraft(title) }, [title, editing])

  const commit = (): void => {
    setEditing(false)
    const trimmed = draft.trim()
    if (trimmed !== '' && trimmed !== title) onRename(trimmed)
  }

  if (editing) {
    return (
      <input
        ref={focusAskedFor}
        className="title-edit-input"
        data-testid="session-title-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit() }
          // Not left to bubble: Escape cancels the edit, not also a dialog or menu on the shared Escape stack.
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setDraft(title); setEditing(false) }
        }}
      />
    )
  }

  return (
    <>
      {title}
      <button
        className="title-edit-button"
        data-testid="session-title-edit"
        title="Rename session"
        aria-label="Rename session"
        onClick={() => setEditing(true)}
      >
        <RenameIcon />
      </button>
    </>
  )
}
