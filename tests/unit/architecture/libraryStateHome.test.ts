import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { LIBRARY_STATE } from '@shared/libraryState'

/**
 * Prevents: a library preference kept in one window's localStorage. Until 1.39 the sidebar's
 * arrangement and each chat's settings were, so a remote window (whose renderer runs at home) read
 * home's, and showed the work machine's sessions with none of the work machine's groups or
 * tool-call choices. They are now main's library state (`shared/libraryState.ts`), read and written
 * over `remote`-scoped IPC.
 *
 * The next such preference is one entry in `LIBRARY_STATE`, never a field of the per-window
 * `ViewerUiState` in `state/uiState.ts`: no registry field may be named in that file outside its
 * comments, and no renderer file writes the keys 1.38 kept them under.
 */
const root = resolve(__dirname, '../../..')
const UI_STATE = 'src/renderer/state/uiState.ts'
const LEGACY_KEYS = ['apiary.shared', 'apiary.chatSettings']

const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? filesUnder(path) : /\.tsx?$/.test(name) ? [path] : []
  })
}

describe('library state lives in main, not in a window\'s storage', () => {
  it('state/uiState.ts names no library field (add it to LIBRARY_STATE instead)', () => {
    // The legacy keys themselves are read once for the seed, so their spelling does not count.
    const code = withoutComments(readFileSync(resolve(root, UI_STATE), 'utf8')).replace(/'apiary\.[\w.]+'/g, "''")
    const named = Object.keys(LIBRARY_STATE).filter((key) => new RegExp(`\\b${key}\\b`).test(code))
    expect(named, `${UI_STATE} names library fields; declare them in src/shared/libraryState.ts`).toEqual([])
  })

  it('the keys library state used to live under are only ever read, once, for the seed', () => {
    // Each may appear only as `read('<key>')` in uiState.ts (`legacyLibraryRecords`): not in a
    // constant a save could reuse, and nowhere else in the renderer.
    const misuses = filesUnder(resolve(root, 'src/renderer')).flatMap((file) => {
      const code = withoutComments(readFileSync(file, 'utf8'))
      const rel = relative(root, file)
      return LEGACY_KEYS.flatMap((key) => {
        const uses = code.split(`'${key}'`).length - 1
        const reads = rel === UI_STATE ? code.split(`read('${key}')`).length - 1 : 0
        return uses > reads ? [`${rel}: '${key}'`] : []
      })
    })
    expect(misuses).toEqual([])
  })
})
