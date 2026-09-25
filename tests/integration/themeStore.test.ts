import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ThemeStore } from '../../src/main/theme/themeStore'
import { BUILTIN_THEMES } from '../../src/shared/theme/builtins'

let dir: string
let file: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apiary-themes-')); file = join(dir, 'themes.json') })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

const matrix = BUILTIN_THEMES[0]

describe('ThemeStore', () => {
  it('starts on the original look with nothing saved', () => {
    const store = new ThemeStore(file)
    expect(store.activeId).toBeNull()
    expect(store.activeSpec()).toBeNull()
    expect(store.saved).toEqual([])
    expect(existsSync(file)).toBe(false)
  })

  it('saves, activates, and reads back what it saved', () => {
    const a = new ThemeStore(file)
    const saved = a.add('My matrix', matrix.spec)
    a.setActive(saved.id)
    const b = new ThemeStore(file)
    expect(b.activeId).toBe(saved.id)
    expect(b.activeSpec()?.name).toBe('My matrix')
    expect(b.saved.map((t) => t.name)).toEqual(['My matrix'])
  })

  it('activates a built-in by id, and refuses an id that names nothing', () => {
    const store = new ThemeStore(file)
    store.setActive('builtin:neon')
    expect(store.activeSpec()?.name).toBe('Neon cyberpunk')
    expect(() => { store.setActive('nope') }).toThrow()
  })

  it('re-validates every saved theme on load — a hand-edited file cannot slip anything past', () => {
    writeFileSync(file, JSON.stringify({
      version: 1,
      activeThemeId: 'evil',
      themes: [
        { id: 'evil', name: 'Evil', prompt: null, createdAt: 1, spec: { palette: { bg: 'url(https://x/y)', accent: '#ff0000' }, effects: [{ kind: 'fireworks' }] } },
        { id: '', spec: {} },
        { name: 'no id', spec: {} },
        'not even an object',
      ],
      options: { animated: 'yes', intensity: 7, model: 'gpt-9' },
    }))
    const store = new ThemeStore(file)
    expect(store.saved).toHaveLength(1)
    // The url() colour is gone; the red survives (and the ink drawn on it was made readable).
    expect(store.activeSpec()?.palette.bg).toBeUndefined()
    expect(store.activeSpec()?.palette.accent).toBe('#ff0000ff')
    expect(store.activeSpec()?.effects).toEqual([])
    expect(store.options).toEqual({ animated: true, intensity: 1, model: 'sonnet' })
  })

  it('starts empty from a corrupt file without throwing, and leaves it alone until something changes', () => {
    writeFileSync(file, '{ not json')
    const store = new ThemeStore(file)
    expect(store.saved).toEqual([])
    expect(readFileSync(file, 'utf8')).toBe('{ not json')
  })

  it('an active theme that is deleted leaves the original look active', () => {
    const store = new ThemeStore(file)
    const saved = store.add('Temp', matrix.spec)
    store.setActive(saved.id)
    store.remove(saved.id)
    expect(store.activeId).toBeNull()
    expect(() => { store.remove('builtin:matrix') }).toThrow()
  })

  it('renames with the same cleaning a generated name gets', () => {
    const store = new ThemeStore(file)
    const saved = store.add('A', matrix.spec)
    store.rename(saved.id, 'B\u0000\u001b[31m'.padEnd(200, 'x'))
    expect(new ThemeStore(file).saved[0].name.length).toBeLessThanOrEqual(60)
    expect(new ThemeStore(file).saved[0].name.startsWith('B')).toBe(true)
  })

  it('writes atomically, leaving no temp file behind', () => {
    const store = new ThemeStore(file)
    store.add('A', matrix.spec)
    store.setOptions({ animated: false, intensity: 0.4, model: 'haiku' })
    store.setOptions({ model: 'not-a-model' })
    expect(readdirSync(dir)).toEqual(['themes.json'])
    expect(new ThemeStore(file).options).toEqual({ animated: false, intensity: 0.4, model: 'haiku' })
  })
})
