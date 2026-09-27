import type { JSX } from 'react'
import type { AppSettingsPayload } from '@shared/api'
import { CheckboxSetting } from '../fields/CheckboxSetting'

/**
 * The indexed/notesIndexed/rebuilding state is owned by the dialog shell, not this section, even
 * though only this section shows it: the shell also loads it once on open and re-reads it on every
 * tree change for the dialog's whole life (see SettingsDialog.tsx), and scoping that to this
 * component's own mount would refetch every time this tab is revisited instead of only once —
 * a behaviour change the registry split (UI-20) is not meant to make.
 */
export function SearchSection(
  { draft, patch, indexed, notesIndexed, rebuilding, onRebuild }: {
    draft: AppSettingsPayload
    patch: (fields: Partial<AppSettingsPayload>) => void
    indexed: number | null
    notesIndexed: number
    rebuilding: boolean
    onRebuild: () => void
  },
): JSX.Element {
  return (
    <>
      <CheckboxSetting
        testId="setting-search-chat-content"
        checked={draft.searchChatContent}
        onChange={(checked) => { patch({ searchChatContent: checked }) }}
        label="Search inside conversations"
        help={(
          <>
            Matches what was actually said in a session — ticket and merge-request
            numbers, branch names, pipeline ids, any phrase you remember — not just the
            session title. Turning this off falls back to titles alone and stops Apiary
            keeping the index up to date.
          </>
        )}
      />

      <CheckboxSetting
        testId="setting-search-session-notes"
        checked={draft.searchSessionNotes}
        onChange={(checked) => { patch({ searchSessionNotes: checked }) }}
        label="Search session notes"
        help={(
          <>
            Notes you write on a session — the ticket you were on, the MR you had open —
            are matched by the search box too. Turning this off empties the note index;
            the notes themselves are kept and still show when you hover a session.
          </>
        )}
      />

      <div className="settings-row settings-row-indent">
        <span className="settings-help" data-testid="search-note-status">
          {`${String(notesIndexed)} ${notesIndexed === 1 ? 'note' : 'notes'} indexed.`}
        </span>
      </div>

      <div className="settings-row settings-row-indent">
        <span className="settings-help" data-testid="search-index-status">
          {indexed === null
            ? 'The index is not available.'
            : `${String(indexed)} ${indexed === 1 ? 'session' : 'sessions'} indexed.`}
          {' '}Apiary keeps this up to date on its own, reading only what has changed.
          Rebuild it if results ever look stale.
        </span>
        <button
          className="btn"
          data-testid="search-rebuild"
          disabled={rebuilding || (!draft.searchChatContent && !draft.searchSessionNotes)}
          onClick={onRebuild}
        >
          {rebuilding ? 'Rebuilding…' : 'Rebuild index'}
        </button>
      </div>
    </>
  )
}
