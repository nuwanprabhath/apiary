import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Prevents: persisted state that bypasses `JsonStore`. Before it, `pets.json` and `themes.json`
 * each carried a private copy of tmp+rename and wrote `version: 1` that nothing ever read, and
 * settings and the window layout each had their own "read JSON, fall back to a default" block, so
 * a new store would copy whichever neighbour the author happened to open — with or without an
 * fsync, with or without a version.
 *
 * Every `*.json` file `containerPaths` (src/main/app/container.ts) builds under userData must be
 * listed here with the module that owns it, and that module must open it through `new JsonStore`
 * and must not import the raw fs read/write calls itself. Adding a userData file without an entry
 * fails the first test; bypassing the store fails the second. (`apiary/no-raw-state-write` catches
 * the writes at lint time; this also catches an ad-hoc read, and a store that is never opened.)
 */
const OWNERS: Record<string, string> = {
  'settings.json': 'src/main/settings.ts',
  'session-layout.json': 'src/main/windows/sessionLayoutStore.ts',
  'themes.json': 'src/main/theme/themeStore.ts',
  'pets.json': 'src/main/pets/petStore.ts',
}

const root = resolve(__dirname, '../../..')
const read = (rel: string): string => readFileSync(resolve(root, rel), 'utf8')

describe('persisted stores', () => {
  it('every userData JSON file in container.ts has a registered owner, and no owner is stale', () => {
    const files = [...read('src/main/app/container.ts').matchAll(/join\(userData, '([^']+\.json)'\)/g)].map((m) => m[1])
    expect(files.length).toBeGreaterThan(0)
    expect([...files].sort()).toEqual(Object.keys(OWNERS).sort())
  })

  describe.each(Object.entries(OWNERS))('%s is owned by %s', (_file, owner) => {
    const source = read(owner)

    it('constructs a JsonStore', () => {
      expect(source).toMatch(/new JsonStore</)
    })

    it('does not import raw fs reads or writes', () => {
      const fsImports = [...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*'(?:node:)?fs(?:\/promises)?'/g)].map((m) => m[1])
      expect(fsImports).toEqual([])
    })
  })
})
