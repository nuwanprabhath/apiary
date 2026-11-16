import { type RefObject, useEffect, useMemo, useRef, useState } from 'react'
import type { PluginInfoPayload } from '@shared/api'
import { queryWords, searchSettings, visibleEntries, type SectionHits } from './searchSettings'
import type { SettingEntry } from './settingsIndex'
import { useRevealSetting } from './useRevealSetting'
import { useEscape } from '../../ui/useEscape'
import { focusAskedFor } from '../../ui/focusUnlessTyping'
import { primaryModifier } from '../../ui/platform'

interface SettingsSearch {
  query: string
  setQuery: (query: string) => void
  words: string[]
  searching: boolean
  groups: SectionHits[]
  searchRef: RefObject<HTMLInputElement | null>
  paneRef: RefObject<HTMLDivElement | null>
  /** Shows the setting's section, scrolled to it, and ends the search. */
  open: (entry: SettingEntry) => void
}

/**
 * The dialog's search: the query, what matches it, Cmd/Ctrl+F to the field, Escape to clear it,
 * and opening a result. The section the person was on is never changed by typing, so clearing the
 * query puts them back where they were.
 */
export function useSettingsSearch(
  { plugins, sections, machineHost, ready, setSection }: {
    plugins: readonly PluginInfoPayload[]
    sections: ReadonlyArray<{ id: string; label: string }>
    machineHost: string | null
    /** The settings are loaded, so a section is drawn and can be scrolled. */
    ready: boolean
    setSection: (id: string) => void
  },
): SettingsSearch {
  const [query, setQuery] = useState('')
  const [revealed, setRevealed] = useState<SettingEntry | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const paneRef = useRef<HTMLDivElement | null>(null)
  const words = queryWords(query)
  const searching = words.length > 0
  const groups = useMemo(() => {
    const entries = visibleEntries(plugins, new Set(sections.map((s) => s.id)), machineHost === null)
    return searchSettings(entries, sections, query)
  }, [plugins, sections, machineHost, query])

  // Escape clears the search first; the next one closes the dialog.
  useEscape(() => { setQuery('') }, { enabled: query !== '' })
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!primaryModifier(e) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'f') return
      e.preventDefault()
      focusAskedFor(searchRef.current)
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [])
  useRevealSetting(paneRef, revealed, ready && !searching)

  const open = (entry: SettingEntry): void => {
    setSection(entry.section)
    setQuery('')
    setRevealed(entry)
  }
  return { query, setQuery, words, searching, groups, searchRef, paneRef, open }
}
