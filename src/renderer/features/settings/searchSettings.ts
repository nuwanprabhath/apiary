import type { PluginInfoPayload } from '@shared/api'
import { isThisMachineOnly, SEARCH_ENTRIES, type SettingEntry } from './settingsIndex'
import { isLinux } from '../../ui/platform'

/** What the search needs of a section. */
interface SectionRef {
  id: string
  label: string
}

export interface SectionHits {
  section: SectionRef
  hits: SettingEntry[]
}

/** The words of a query, lower case. A setting matches when it contains every one, in any order. */
export const queryWords = (query: string): string[] => query.toLowerCase().split(/\s+/).filter((w) => w !== '')

/** Each plugin's own settings, from what it declared, so a new plugin field is searchable as it appears. */
export function pluginEntries(plugins: readonly PluginInfoPayload[]): SettingEntry[] {
  return plugins.flatMap((p): SettingEntry[] => [
    {
      id: `plugin-${p.id}`, section: 'plugins', label: p.name, description: p.description ?? '',
      keywords: ['plugin', 'bar', 'button'], testIds: [`setting-plugin-${p.id}`],
    },
    ...p.fields.map((f): SettingEntry => ({
      id: `plugin-${p.id}-${f.key}`, section: 'plugins', label: f.label, description: f.help ?? '',
      keywords: [p.name], testIds: [`plugin-setting-${p.id}-${f.key}`],
    })),
  ])
}

/** The entries this dialog can show right now: this machine's or the work machine's, on this system. */
export function visibleEntries(
  plugins: readonly PluginInfoPayload[], sectionIds: ReadonlySet<string>, thisMachine: boolean,
): SettingEntry[] {
  return [...SEARCH_ENTRIES, ...pluginEntries(plugins)].filter((e) => sectionIds.has(e.section)
    && (thisMachine || !isThisMachineOnly(e))
    && (e.linuxOnly !== true || isLinux()))
}

const haystack = (e: SettingEntry, sectionLabel: string): string =>
  [e.label, e.description, sectionLabel, ...(e.keywords ?? [])].join('\n').toLowerCase()

/** The settings matching `query`, grouped under their section in the dialog's order; nothing for a blank query. */
export function searchSettings(
  entries: readonly SettingEntry[], sections: readonly SectionRef[], query: string,
): SectionHits[] {
  const words = queryWords(query)
  if (words.length === 0) return []
  return sections.flatMap((section): SectionHits[] => {
    const hits = entries.filter((e) => {
      if (e.section !== section.id) return false
      const text = haystack(e, section.label)
      return words.every((w) => text.includes(w))
    })
    return hits.length === 0 ? [] : [{ section, hits }]
  })
}

export function highlightRuns(text: string, words: readonly string[]): Array<{ at: number; text: string; hit: boolean }> {
  const lower = text.toLowerCase()
  const marked = new Array<boolean>(text.length).fill(false)
  for (const w of words) {
    for (let from = lower.indexOf(w); from !== -1 && w !== ''; from = lower.indexOf(w, from + 1)) marked.fill(true, from, from + w.length)
  }
  const runs: Array<{ at: number; text: string; hit: boolean }> = []
  for (let at = 0; at < text.length;) {
    const hit = marked[at] === true
    let end = at
    while (end < text.length && (marked[end] === true) === hit) end += 1
    runs.push({ at, text: text.slice(at, end), hit })
    at = end
  }
  return runs
}
