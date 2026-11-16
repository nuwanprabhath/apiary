import { Fragment, type JSX } from 'react'
import { CloseIcon } from '../../ui/icons'
import { focusAskedFor } from '../../ui/focusUnlessTyping'
import { highlightRuns, type SectionHits } from './searchSettings'
import type { SettingEntry } from './settingsIndex'

/** The search field above the section list. Escape and Enter are the dialog's to handle: it knows the results. */
export function SettingsSearchField(
  { query, onChange, onEnter, inputRef }: {
    query: string
    onChange: (query: string) => void
    onEnter: () => void
    inputRef: React.RefObject<HTMLInputElement | null>
  },
): JSX.Element {
  return (
    <div className="settings-search">
      <input
        ref={inputRef}
        className="search"
        type="text"
        role="searchbox"
        data-testid="settings-search"
        aria-label="Search settings"
        placeholder="Search settings"
        value={query}
        onChange={(e) => { onChange(e.target.value) }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return
          e.preventDefault()
          onEnter()
        }}
      />
      {query !== '' && (
        <button
          className="settings-search-clear"
          data-testid="settings-search-clear"
          title="Clear search"
          aria-label="Clear search"
          onClick={() => { onChange(''); focusAskedFor(inputRef.current) }}
        >
          <CloseIcon />
        </button>
      )}
    </div>
  )
}

/** `text` with the query's words marked. */
export function Highlighted({ text, words }: { text: string; words: readonly string[] }): JSX.Element {
  return (
    <>
      {highlightRuns(text, words).map((run) => (run.hit
        ? <mark key={run.at} className="settings-mark">{run.text}</mark>
        : <Fragment key={run.at}>{run.text}</Fragment>))}
    </>
  )
}

/** The settings matching the query, under their section headings. */
export function SettingsResults(
  { groups, words, query, onOpen }: {
    groups: SectionHits[]
    words: readonly string[]
    query: string
    onOpen: (entry: SettingEntry) => void
  },
): JSX.Element {
  if (groups.length === 0) {
    return <p className="empty settings-no-results" data-testid="settings-no-results">{`No settings match “${query.trim()}”`}</p>
  }
  return (
    <div className="settings-results" data-testid="settings-results">
      {groups.map(({ section, hits }) => (
        <section key={section.id} className="settings-result-group" aria-label={section.label}>
          <h3 className="settings-result-heading">{section.label}</h3>
          {hits.map((e) => (
            <button
              key={e.id}
              className="settings-result"
              data-testid={`settings-result-${e.id}`}
              onClick={() => { onOpen(e) }}
            >
              <strong><Highlighted text={e.label} words={words} /></strong>
              <span className="settings-help"><Highlighted text={e.description} words={words} /></span>
            </button>
          ))}
        </section>
      ))}
    </div>
  )
}
