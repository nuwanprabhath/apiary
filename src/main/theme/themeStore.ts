import { randomUUID } from 'node:crypto'
import { validateTheme } from '@shared/theme/validate'
import { BUILTIN_THEMES, BUILTIN_THEME_PREFIX } from '@shared/theme/builtins'
import type { ThemeSpec } from '@shared/theme/spec'
import type { SavedTheme, ThemeOptions } from '@shared/theme/state'
import { clamp, isFiniteNumber, isOneOf, isRecord } from '@shared/guards'
import { JsonStore } from '../fs/jsonStore'
import { log } from '../log/logger'
import { THEME_MODELS } from '@shared/theme/models'

interface ThemeFile {
  activeThemeId: string | null
  themes: SavedTheme[]
  options: ThemeOptions
}

const DEFAULT_OPTIONS: ThemeOptions = { animated: true, intensity: 1, model: 'sonnet' }

/**
 * The theme someone gets before they have ever chosen one (no themes.json yet). Only then: a
 * choice once made — including "Original" — is kept, and a file that exists but cannot be read
 * falls back to the original look, the one that cannot go wrong.
 */
export const DEFAULT_THEME_ID = `${BUILTIN_THEME_PREFIX}glass`
const themeExists = (id: string, themes: SavedTheme[]): boolean =>
  BUILTIN_THEMES.some((b) => b.id === id) || themes.some((t) => t.id === id)

/** Everything read back is re-validated; a theme that cannot be read is dropped and the rest kept. */
function parseThemeFile(raw: unknown): ThemeFile {
  const r = isRecord(raw) ? raw : {}
  const themes: SavedTheme[] = []
  for (const t of Array.isArray(r.themes) ? (r.themes as unknown[]) : []) {
    const o = isRecord(t) ? t : {}
    if (typeof o.id !== 'string' || o.id === '' || !isRecord(o.spec)) {
      log.warn('theme', 'dropped invalid saved theme')
      continue
    }
    const { spec } = validateTheme(o.spec)
    themes.push({
      id: o.id,
      name: typeof o.name === 'string' ? validateTheme({ ...spec, name: o.name }).spec.name : spec.name,
      prompt: typeof o.prompt === 'string' ? o.prompt.slice(0, 2000) : null,
      createdAt: isFiniteNumber(o.createdAt) ? o.createdAt : 0,
      spec,
    })
  }
  const options = isRecord(r.options) ? r.options : {}
  const active = typeof r.activeThemeId === 'string' ? r.activeThemeId : null
  return {
    activeThemeId: active !== null && themeExists(active, themes) ? active : null,
    themes,
    options: {
      animated: typeof options.animated === 'boolean' ? options.animated : DEFAULT_OPTIONS.animated,
      intensity: isFiniteNumber(options.intensity) ? clamp(options.intensity, 0, 1) : DEFAULT_OPTIONS.intensity,
      model: isOneOf(THEME_MODELS, options.model) ? options.model : DEFAULT_OPTIONS.model,
    },
  }
}

/**
 * `themes.json`: the user's saved themes, which one is active, and the effects options.
 *
 * Kept out of settings.json on purpose (see CLAUDE.md, "Changing a default reaches nobody").
 * Everything read back is validated again — the file is the user's to edit, and may be from a
 * newer or older Apiary — so a theme on disk can never reach the page without passing
 * `validateTheme`. Writes go to a temp file and are renamed into place, so a crash mid-write
 * leaves the previous file, never half of one (`JsonStore`).
 */
export class ThemeStore {
  private data: ThemeFile
  private readonly store: JsonStore<ThemeFile>

  constructor(file: string, defaultThemeId: string | null = DEFAULT_THEME_ID) {
    this.store = new JsonStore<ThemeFile>({
      file,
      version: 1,
      parse: parseThemeFile,
      fallback: (reason) => {
        if (reason === 'unreadable') log.warn('theme', 'themes file unreadable, starting empty')
        const first = reason === 'missing' && defaultThemeId !== null && themeExists(defaultThemeId, []) ? defaultThemeId : null
        return { activeThemeId: first, themes: [], options: { ...DEFAULT_OPTIONS } }
      },
    })
    this.data = this.store.load()
  }

  private exists(id: string): boolean {
    return themeExists(id, this.data.themes)
  }

  private save(): void {
    this.store.save(this.data)
  }

  get activeId(): string | null { return this.data.activeThemeId }
  get saved(): SavedTheme[] { return this.data.themes }
  get options(): ThemeOptions { return this.data.options }

  /** The spec of whatever is active, or null for Apiary's own look. */
  activeSpec(): ThemeSpec | null {
    const id = this.data.activeThemeId
    if (id === null) return null
    return BUILTIN_THEMES.find((b) => b.id === id)?.spec ?? this.data.themes.find((t) => t.id === id)?.spec ?? null
  }

  setActive(id: string | null): void {
    if (id !== null && !this.exists(id)) throw new Error('No such theme.')
    this.data.activeThemeId = id
    this.save()
  }

  add(name: string, spec: unknown, prompt: string | null = null): SavedTheme {
    const { spec: valid } = validateTheme(typeof spec === 'object' && spec !== null ? { ...spec, name } : spec)
    const theme: SavedTheme = { id: randomUUID(), name: valid.name, prompt, createdAt: Date.now(), spec: valid }
    this.data.themes.push(theme)
    this.save()
    return theme
  }

  rename(id: string, name: string): void {
    const t = this.data.themes.find((x) => x.id === id)
    if (t === undefined) throw new Error('Only a saved theme can be renamed.')
    const clean = validateTheme({ ...t.spec, name }).spec.name
    t.name = clean
    t.spec = { ...t.spec, name: clean }
    this.save()
  }

  remove(id: string): void {
    const before = this.data.themes.length
    this.data.themes = this.data.themes.filter((t) => t.id !== id)
    if (this.data.themes.length === before) throw new Error('Only a saved theme can be deleted.')
    if (this.data.activeThemeId === id) this.data.activeThemeId = null
    this.save()
  }

  setOptions(o: Partial<ThemeOptions>): void {
    if (typeof o.animated === 'boolean') this.data.options.animated = o.animated
    if (isFiniteNumber(o.intensity)) this.data.options.intensity = clamp(o.intensity, 0, 1)
    if (isOneOf(THEME_MODELS, o.model)) this.data.options.model = o.model
    this.save()
  }
}
