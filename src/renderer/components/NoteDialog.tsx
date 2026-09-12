import { useEffect, useRef, useState } from 'react'

/**
 * Writing a note on a session.
 *
 * A note is for the context a title cannot hold — what you were actually doing, which ticket or
 * merge request it belongs to, what you had ruled out. It is free text on purpose: the moment it
 * becomes fields, it stops being something anyone writes in passing.
 *
 * Cmd/Ctrl+Enter saves, because this is a small box that people will type one line into and want
 * to be done with; Escape cancels, like every other dialog here.
 */
interface Props {
  sessionTitle: string
  /** The note as it stands, '' when there is none yet. */
  initial: string
  onSave: (note: string) => void
  onClose: () => void
}

export function NoteDialog({ sessionTitle, initial, onSave, onClose }: Props): JSX.Element {
  const [draft, setDraft] = useState(initial)
  const areaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    const area = areaRef.current
    if (area === null) return
    area.focus()
    // Caret at the end rather than selecting everything: reopening a note is almost always to add
    // to it, and a select-all means the first keystroke destroys what is there.
    area.setSelectionRange(area.value.length, area.value.length)
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [onClose])

  const save = (): void => { onSave(draft.trim()) }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal note-dialog" data-testid="note-dialog" role="dialog" aria-modal="true">
        <h2>Note</h2>
        <p className="note-dialog-session" data-testid="note-dialog-session">{sessionTitle}</p>

        <textarea
          ref={areaRef}
          className="note-dialog-input"
          data-testid="note-input"
          value={draft}
          placeholder="What is this session for? A ticket, an MR, what you were chasing…"
          onChange={(e) => { setDraft(e.target.value) }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save() }
          }}
        />
        <p className="settings-help">
          Notes show when you hover the session in the sidebar, and are searched from the search
          box — so a merge-request or ticket number written here finds the session later.
        </p>

        <div className="modal-actions">
          {initial !== '' && (
            <button
              className="note-dialog-remove"
              data-testid="note-remove"
              // Saving an empty note is what removes it, so this is the same action with the box
              // cleared — no separate delete path to keep in step with the index.
              onClick={() => { onSave('') }}
            >
              Remove note
            </button>
          )}
          <span className="modal-actions-spacer" />
          <button data-testid="note-cancel" onClick={onClose}>Cancel</button>
          <button className="primary" data-testid="note-save" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  )
}
