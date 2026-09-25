import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { validateTheme } from '@shared/theme/validate'
import { BUILTIN_THEMES } from '@shared/theme/builtins'
import type { ThemeSpec } from '@shared/theme/spec'
import type { SavedTheme, ThemeOptions } from '@shared/api'
import { log } from '../log/logger'
import { THEME_MODELS, type ThemeModel } from './themeGenerator'

interface ThemeFile {
  version: 1
  activeThemeId: string | null
  themes: SavedTheme[]
  options: ThemeOptions
}

const DEFAULT_OPTIONS: ThemeOptions = { animated: true, intensity: 1, model: 'sonnet' }
const isModel = (m: unknown): m is ThemeModel => typeof m === 'string' && (THEME_MODELS as readonly string[]).includes(m)

/**
 * `themes.json`: the user's saved themes, which one is active, and the effects options.
 *
 * Kept out of settings.json on purpose (see CLAUDE.md, "Changing a default reaches nobody").
 * Everything read back is validated again — the file is the user's to edit, and may be from a
 * newer or older Apiary — so a theme on disk can never reach the page without passing
 * `validateTheme`. Writes go to a temp file and are renamed into place, so a crash mid-write
 * leaves the previous file, never half of one.
 */
export class ThemeStore {
  private data: ThemeFile

  constructor(private readonly file: string) {
    this.data = this.load()
  }

  private load(): ThemeFile {
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(this.file, 'utf8'))
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log.warn('theme', 'themes file unreadable, starting empty')
      return { version: 1, activeThemeId: null, themes: [], options: { ...DEFAULT_OPTIONS } }
    }
    const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
    const themes: SavedTheme[] = []
    for (const t of Array.isArray(r.themes) ? (r.themes as unknown[]) : []) {
      const o = (typeof t === 'object' && t !== null ? t : {}) as Record<string, unknown>
      if (typeof o.id !== 'string' || o.id === '' || typeof o.spec !== 'object' || o.spec === null) {
        log.warn('theme', 'dropped invalid saved theme')
        continue
      }
      const { spec } = validateTheme(o.spec)
      themes.push({
        id: o.id,
        name: typeof o.name === 'string' ? validateTheme({ ...spec, name: o.name }).spec.name : spec.name,
        prompt: typeof o.prompt === 'string' ? o.prompt.slice(0, 2000) : null,
        createdAt: typeof o.createdAt === 'number' && Number.isFinite(o.createdAt) ? o.createdAt : 0,
        spec,
      })
    }
    const options = (typeof r.options === 'object' && r.options !== null ? r.options : {}) as Record<string, unknown>
    const active = typeof r.activeThemeId === 'string' ? r.activeThemeId : null
    return {
      version: 1,
      activeThemeId: active !== null && this.exists(active, themes) ? active : null,
      themes,
      options: {
        animated: typeof options.animated === 'boolean' ? options.animated : DEFAULT_OPTIONS.animated,
        intensity: typeof options.intensity === 'number' && Number.isFinite(options.intensity)
          ? Math.min(1, Math.max(0, options.intensity)) : DEFAULT_OPTIONS.intensity,
        model: isModel(options.model) ? options.model : DEFAULT_OPTIONS.model,
      },
    }
  }

  private exists(id: string, themes: SavedTheme[] = this.data.themes): boolean {
    return BUILTIN_THEMES.some((b) => b.id === id) || themes.some((t) => t.id === id)
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.${String(process.pid)}.tmp`
    writeFileSync(tmp, JSON.stringify(this.data, null, 2))
    renameSync(tmp, this.file)
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
    if (typeof o.intensity === 'number' && Number.isFinite(o.intensity)) {
      this.data.options.intensity = Math.min(1, Math.max(0, o.intensity))
    }
    if (isModel(o.model)) this.data.options.model = o.model
    this.save()
  }
}
