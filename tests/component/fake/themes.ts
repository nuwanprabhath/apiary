/**
 * Themes in the fake, modelled on main's `ThemeStore` and the theme handlers: ids are minted here, a
 * spec only gets in through `validateTheme`, only a saved theme can be renamed or deleted, an id must
 * name a theme that exists, and the options are clamped. Every change reaches every window as
 * `themeChanged`. What only Claude can decide (the design) is canned. The contract
 * (`tests/contract/clauses/themes.ts`) pins it.
 */
import type { ApiaryApi, SavedTheme, ThemeOptions, ThemeState } from '@shared/api'
import { clamp, isFiniteNumber, isOneOf } from '@shared/guards'
import { BUILTIN_THEMES } from '@shared/theme/builtins'
import { THEME_MODELS } from '@shared/theme/models'
import { validateTheme } from '@shared/theme/validate'
import type { Env } from './state'

type ThemesApi = Pick<ApiaryApi,
  | 'themeState' | 'themeGpuCompositing' | 'themeApply' | 'themeSave' | 'themeRename' | 'themeDelete' | 'themeSetOptions'
  | 'themeGenerate' | 'themeGenerateCancel'>

/** The state a fresh profile starts in: the original look, nothing saved, every built-in on offer. */
const OPTIONS: ThemeOptions = { animated: true, intensity: 1, model: 'sonnet' }

export function initialThemeState(): ThemeState {
  return {
    activeId: null,
    active: null,
    saved: [],
    builtins: BUILTIN_THEMES.map((b) => ({ id: b.id, spec: b.spec })),
    options: { ...OPTIONS },
    safeMode: false,
  }
}

export function themesApi(env: Env): ThemesApi {
  const { state, emit } = env
  let minted = 0
  const set = (next: ThemeState): void => { state.theme = next; emit('themeChanged', next) }
  const specOf = (id: string): ThemeState['active'] =>
    state.theme.builtins.find((b) => b.id === id)?.spec ?? state.theme.saved.find((t) => t.id === id)?.spec ?? null

  return {
    themeState: async () => state.theme,
    themeGpuCompositing: async () => true,
    themeApply: async (id) => {
      if (id !== null && specOf(id) === null) throw new Error('No such theme.')
      set({ ...state.theme, activeId: id, active: id === null ? null : specOf(id) })
    },
    themeSave: async (name, spec, prompt) => {
      const { spec: valid } = validateTheme(typeof spec === 'object' && spec !== null ? { ...spec, name } : spec)
      minted += 1
      const saved: SavedTheme = { id: `saved-${String(minted)}`, name: valid.name, prompt: prompt ?? null, createdAt: Date.now(), spec: valid }
      set({ ...state.theme, saved: [...state.theme.saved, saved] })
      return saved
    },
    themeRename: async (id, name) => {
      const t = state.theme.saved.find((x) => x.id === id)
      if (t === undefined) throw new Error('Only a saved theme can be renamed.')
      const clean = validateTheme({ ...t.spec, name }).spec.name
      const renamed = { ...t, name: clean, spec: { ...t.spec, name: clean } }
      set({
        ...state.theme,
        saved: state.theme.saved.map((x) => (x.id === id ? renamed : x)),
        active: state.theme.activeId === id ? renamed.spec : state.theme.active,
      })
    },
    themeDelete: async (id) => {
      if (!state.theme.saved.some((t) => t.id === id)) throw new Error('Only a saved theme can be deleted.')
      const wasActive = state.theme.activeId === id
      set({ ...state.theme, saved: state.theme.saved.filter((t) => t.id !== id), activeId: wasActive ? null : state.theme.activeId, active: wasActive ? null : state.theme.active })
    },
    themeSetOptions: async (o) => {
      const options = { ...state.theme.options }
      if (typeof o.animated === 'boolean') options.animated = o.animated
      if (isFiniteNumber(o.intensity)) options.intensity = clamp(o.intensity, 0, 1)
      if (isOneOf(THEME_MODELS, o.model)) options.model = o.model
      set({ ...state.theme, options })
    },
    themeGenerate: async (request) => {
      if (request.trim() === '') throw new Error('Describe the theme you would like.')
      return { spec: validateTheme(BUILTIN_THEMES[0].spec).spec, note: null }
    },
    themeGenerateCancel: () => {},
  }
}
