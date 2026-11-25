import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * Prevents: a main subsystem whose nested `CLAUDE.md` nobody can find. The root `CLAUDE.md` map is
 * how an agent reaches a folder's rules; `src/main/schedule/` and later `src/main/desk/` were each
 * added with no row there. Every `src/main/<folder>` that has a nested `CLAUDE.md` is named in the
 * root map as `main/<folder>/`.
 */
const root = resolve(__dirname, '../../..')
const mainDir = join(root, 'src/main')

describe('every main subsystem with a nested CLAUDE.md has a row in the root map', () => {
  it('names each such folder in root CLAUDE.md', () => {
    const map = readFileSync(join(root, 'CLAUDE.md'), 'utf8')
    const unmapped = readdirSync(mainDir)
      .filter((name) => statSync(join(mainDir, name)).isDirectory())
      .filter((name) => existsSync(join(mainDir, name, 'CLAUDE.md')))
      .filter((name) => !map.includes(`main/${name}/`))
    expect(unmapped, 'add a row to the Map table in root CLAUDE.md for each folder').toEqual([])
  })
})
