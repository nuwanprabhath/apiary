import type { JSX } from 'react'
import { ArrowDownIcon, ArrowUpIcon, CloseIcon } from '../../ui/icons'
import type { TranscriptFind } from './useTranscriptFind'

/** The floating widget Cmd/Ctrl+F opens at a transcript's top-right: a field, "3 of 12", previous, next, close. */
export function FindBar({ find }: { find: TranscriptFind }): JSX.Element {
  const noResults = find.query !== '' && find.total === 0
  const noMatches = find.query === '' || noResults
  return (
    <div className="find-bar" data-testid="find-bar" data-popup="" role="search" aria-label="Find in transcript">
      <input
        ref={find.inputRef}
        className={`find-input${noResults ? ' no-results' : ''}`}
        data-testid="find-input"
        aria-label="Find in transcript"
        placeholder="Find"
        value={find.query}
        onChange={(e) => { find.setQuery(e.target.value) }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); find.close() }
          else if (e.key === 'Enter') { e.preventDefault(); find.step(e.shiftKey ? -1 : 1) }
        }}
      />
      <span className={`find-count${noResults ? ' no-results' : ''}`} data-testid="find-count" aria-live="polite">
        {find.query === '' ? '' : noResults ? 'No results' : `${find.position} of ${find.total}`}
      </span>
      <button
        className="icon-button find-button" data-testid="find-prev" aria-label="Previous match"
        title="Previous match (Shift+Enter)" disabled={noMatches} onClick={() => { find.step(-1) }}
      >
        <ArrowUpIcon />
      </button>
      <button
        className="icon-button find-button" data-testid="find-next" aria-label="Next match"
        title="Next match (Enter)" disabled={noMatches} onClick={() => { find.step(1) }}
      >
        <ArrowDownIcon />
      </button>
      <button
        className="icon-button find-button" data-testid="find-close" aria-label="Close find"
        title="Close (Escape)" onClick={find.close}
      >
        <CloseIcon />
      </button>
    </div>
  )
}
