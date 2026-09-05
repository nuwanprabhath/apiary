import { useEffect, useRef, useState } from 'react'

interface Props {
  title: string
  onRename: (title: string) => void
}

/**
 * The session header's title, editable in place — hover reveals a pencil button (the same
 * affordance VS Code's own tab rename uses); clicking it swaps the heading for a text input.
 * Enter or blur commits, Escape cancels. An empty/whitespace-only submission is treated as "no
 * change" here (the input just reverts) rather than clearing the title — `onRename` itself still
 * accepts an empty string to mean "clear back to the auto-derived title" for a caller that wants
 * that, but there is no UI path to type nothing and hit Enter to get it, since that reads more
 * like an accidental empty submit than a deliberate reset.
 */
export function EditableSessionTitle({ title, onRename }: Props): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // Keep the draft in sync with the real title while not editing (e.g. switching to a
  // different session, or this same session's title changing elsewhere) so a later edit starts
  // from the current value rather than one left over from a previous session's edit.
  useEffect(() => { if (!editing) setDraft(title) }, [title, editing])

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const commit = (): void => {
    setEditing(false)
    const trimmed = draft.trim()
    if (trimmed !== '' && trimmed !== title) onRename(trimmed)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="title-edit-input"
        data-testid="session-title-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit() }
          if (e.key === 'Escape') { e.preventDefault(); setDraft(title); setEditing(false) }
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
        <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path
            d="M11.3 2.3a1 1 0 0 1 1.4 0l1 1a1 1 0 0 1 0 1.4l-7 7-2.9.6.6-2.9 7-7Z"
            stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"
          />
        </svg>
      </button>
    </>
  )
}
