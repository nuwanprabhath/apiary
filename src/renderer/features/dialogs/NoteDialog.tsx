import { type JSX, useRef, useState } from 'react'
import { ErrorBoundary } from '../../ui/ErrorBoundary'
import { Modal } from '../../ui/Modal'

/** Writing a note on a session. Free text on purpose; Cmd/Ctrl+Enter saves, Escape cancels. */
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

  const save = (): void => { onSave(draft.trim()) }

  return (
    <ErrorBoundary label="This dialog">
      <Modal
        testId="note-dialog"
        titleId="note-dialog-title"
        onClose={onClose}
        initialFocusSelector='[data-testid="note-input"]'
        closeOnBackdropClick
      >
        <h2 id="note-dialog-title">Note</h2>
        <p className="note-dialog-session" data-testid="note-dialog-session">{sessionTitle}</p>

        <textarea
          ref={areaRef}
          className="note-dialog-input"
          data-testid="note-input"
          value={draft}
          placeholder="What is this session for? A ticket, an MR, what you were chasing…"
          onChange={(e) => { setDraft(e.target.value) }}
          onFocus={(e) => {
            // Caret at the end, not select-all: reopening a note is almost always to add to it.
            const area = e.currentTarget
            area.setSelectionRange(area.value.length, area.value.length)
          }}
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
              className="btn note-dialog-remove"
              data-testid="note-remove"
              // Saving an empty note removes it: no separate delete path.
              onClick={() => { onSave('') }}
            >
              Remove note
            </button>
          )}
          <span className="modal-actions-spacer" />
          <button className="btn" data-testid="note-cancel" onClick={onClose}>Cancel</button>
          <button className="btn primary" data-testid="note-save" onClick={save}>Save</button>
        </div>
      </Modal>
    </ErrorBoundary>
  )
}
