import type { JSX, RefObject } from 'react'
import type { SettingEntry } from './settingsIndex'
import type { SectionHits } from './searchSettings'
import { Highlighted, SettingsSearchField } from './SettingsSearch'

/** The search field and the section list; while searching, the list is the sections with matches, counted. */
export function SettingsNav(
  { sections, activeId, searching, groups, words, query, onQuery, onOpen, onSection, inputRef }: {
    sections: ReadonlyArray<{ id: string; label: string }>
    activeId: string | undefined
    searching: boolean
    groups: SectionHits[]
    words: readonly string[]
    query: string
    onQuery: (query: string) => void
    onOpen: (entry: SettingEntry) => void
    onSection: (id: string) => void
    inputRef: RefObject<HTMLInputElement | null>
  },
): JSX.Element {
  return (
    <nav className="settings-nav" aria-label="Settings sections">
      <SettingsSearchField
        query={query}
        onChange={onQuery}
        onEnter={() => { const first = groups[0]?.hits[0]; if (first !== undefined) onOpen(first) }}
        inputRef={inputRef}
      />
      {searching
        ? groups.map(({ section: s, hits }) => (
          <button
            key={s.id}
            className="settings-nav-item"
            data-testid={`settings-nav-${s.id}`}
            data-active={false}
            onClick={() => { const first = hits[0]; if (first !== undefined) onOpen(first) }}
          >
            <span><Highlighted text={s.label} words={words} /></span>
            <span className="settings-nav-count" data-testid={`settings-nav-count-${s.id}`}>{hits.length}</span>
          </button>
        ))
        : sections.map((s) => (
          <button
            key={s.id}
            className="settings-nav-item"
            data-testid={`settings-nav-${s.id}`}
            data-active={activeId === s.id}
            onClick={() => { onSection(s.id) }}
          >
            {s.label}
          </button>
        ))}
    </nav>
  )
}
