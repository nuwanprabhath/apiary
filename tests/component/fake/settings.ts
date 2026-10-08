/**
 * Settings, plugins, the status bar and search in the fake, modelled on main's settings handlers,
 * plugin registries and `SearchService` — they are one area because a settings save is what switches
 * a plugin on or off, imports everything, or turns a kind of search off. A save runs the same
 * `mergePayload` over the same schema as main (a missing key is unchanged, a value of the wrong type
 * is refused, a number is clamped); the plugins' state is what `settingsGet` reports for them. The
 * contract (`tests/contract/clauses/{settings,plugins,search}.ts`) pins it.
 */
import type { ApiaryApi, AppSettingsPayload, PluginInfoPayload } from '@shared/api'
import type { PluginSettingValues } from '@shared/domain/plugins'
import { mergePayload } from '@shared/settings/schema'
import type { Env } from './state'

type SettingsApi = Pick<ApiaryApi,
  | 'settingsGet' | 'settingsSet' | 'pluginList' | 'pluginBarItems' | 'pluginBarRefresh' | 'pluginRunAction'
  | 'statusBarItems' | 'statusBarRefresh' | 'statusBarPanel' | 'statusBarConsent' | 'searchContent' | 'searchRebuild' | 'searchStatus'>

/** A plugin's settings with its declared defaults filled in; a value of the wrong type is as good as absent. */
function withDefaults(fields: PluginInfoPayload['fields'], values: PluginSettingValues | undefined): PluginSettingValues {
  const out: PluginSettingValues = {}
  for (const field of fields) {
    const value = values?.[field.key]
    out[field.key] = value !== undefined && typeof value === typeof field.default ? value : field.default
  }
  return out
}

/** The words of a text, the way the search index reads them. */
const wordsOf = (text: string): string[] => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w !== '')

/** The last word of a query matches as a prefix once it is three letters long, as in the index. */
function matches(words: string[], query: string): boolean {
  const tokens = wordsOf(query)
  if (tokens.length === 0) return false
  return tokens.every((t, i) => words.some((w) => (i === tokens.length - 1 && t.length >= 3 ? w.startsWith(t) : w === t)))
}

export function settingsApi(env: Env): SettingsApi {
  const { state, emit } = env
  const plugin = (id: string): PluginInfoPayload | undefined => state.plugins.find((p) => p.id === id)
  const running = (id: string): boolean => plugin(id)?.enabled === true
  /** The sessions the index covers: imported, and not taken out of the tree. */
  const visible = (): ReturnType<Env['find']>[] =>
    state.sessions.filter((s) => state.imported.has(s.sessionId) && !state.archived.has(s.sessionId))
  const texts = (s: NonNullable<ReturnType<Env['find']>>): string =>
    (s.messages ?? [{ blocks: [{ type: 'text', text: 'fix the export' }] }, { blocks: [{ type: 'text', text: 'done' }] }])
      .flatMap((m) => m.blocks.flatMap((b) => ('text' in b ? [b.text] : []))).join(' ')

  return {
    settingsGet: async (): Promise<AppSettingsPayload> => ({
      ...state.settings,
      // The two fields the plugins own: what is on, and each plugin's values.
      plugins: Object.fromEntries(state.plugins.map((p) => [p.id, p.enabled])),
      pluginSettings: Object.fromEntries(state.plugins.map((p) => [p.id, p.values])),
    }),
    settingsSet: async (incoming) => {
      const wasAutoImporting = state.settings.autoImportAll
      const known = new Set(state.plugins.map((p) => p.id))
      const { merged } = mergePayload(state.settings, incoming, { knownPluginIds: known, isAbsolutePath: (p) => p.startsWith('/') })
      state.settings = merged
      let statusBarChanged = false
      state.plugins = state.plugins.map((p) => {
        const enabled = merged.plugins[p.id] ?? p.enabled
        const values = withDefaults(p.fields, merged.pluginSettings[p.id] ?? p.values)
        if (p.enabled !== enabled && state.statusBar.some((i) => i.pluginId === p.id)) statusBarChanged = true
        return { ...p, enabled, values }
      })
      // Switching a plugin off changes what every open bar should show, and nothing else would tell the windows.
      emit('pluginsChanged')
      if (statusBarChanged) emit('statusBarChanged')
      if (merged.autoImportAll && !wasAutoImporting) {
        for (const s of state.sessions) state.imported.add(s.sessionId)
        emit('treeChanged')
      }
    },

    pluginList: async () => state.plugins,
    pluginBarItems: async (terminal) => {
      if (terminal.kind === 'session' && env.find(terminal.id) === undefined) return []
      return state.pluginBar.filter((item) => running(item.pluginId))
    },
    pluginBarRefresh: async (terminal) => {
      if (terminal.kind === 'session' && env.find(terminal.id) === undefined) return []
      return state.pluginBar.filter((item) => running(item.pluginId))
    },
    // Only a web address is ever opened; anything else a plugin button carries is ignored.
    pluginRunAction: async (item) => {
      if (item.action.kind !== 'open-url') return
      let url: URL
      try { url = new URL(item.action.url) } catch { return }
      if (url.protocol === 'https:' || url.protocol === 'http:') state.opened.push(url.toString())
    },

    statusBarItems: async () => state.statusBar.filter((item) => running(item.pluginId)),
    // A running plugin that refreshes tells every window its items may have changed.
    statusBarRefresh: async (pluginId) => { if (running(pluginId)) emit('statusBarChanged') },
    statusBarPanel: async (pluginId) => (running(pluginId) ? state.statusBarPanel : null),
    // The answer goes to a running plugin that asked; one that did not ask ignores it. Allowed: the
    // question is gone (what replaces it is the plugin's business, set by the test). Declined: the
    // plugin is switched off.
    statusBarConsent: async (pluginId, allow) => {
      if (!running(pluginId) || !state.statusBar.some((i) => i.pluginId === pluginId && i.action.kind === 'consent')) return
      state.statusBar = state.statusBar.filter((i) => i.pluginId !== pluginId)
      emit('statusBarChanged')
      if (allow) return
      state.plugins = state.plugins.map((p) => (p.id === pluginId ? { ...p, enabled: false } : p))
      emit('pluginsChanged')
    },

    searchContent: async (query) => {
      const { searchChatContent, searchSessionNotes } = state.settings
      return visible().flatMap((s) => {
        if (s === undefined) return []
        const inConversation = searchChatContent && matches(wordsOf(texts(s)), query)
        const inNote = searchSessionNotes && matches(wordsOf(s.note ?? ''), query)
        return inConversation || inNote ? [s.sessionId] : []
      })
    },
    searchRebuild: async () => {},
    searchStatus: async () => ({
      indexed: state.settings.searchChatContent ? visible().length : 0,
      notes: state.settings.searchSessionNotes ? visible().filter((s) => (s?.note ?? '') !== '').length : 0,
    }),
  }
}
