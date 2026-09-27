import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { build } from 'esbuild'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SearchClient } from '../../src/main/search/searchClient'
import { SearchIndex } from '../../src/main/search/searchIndex'

/**
 * TEST-7: every other search test exercises only `SearchClient`'s in-process fallback, because
 * under Vitest `searchWorker.js` has never been built beside `searchClient.ts` the way
 * electron-vite emits it in the packaged app — `ensure()` always failed to start the real worker
 * (see `searchClient.ts`'s comment on `workerPath`). That leaves the actual worker-thread path —
 * `search/searchWorker.ts`, the fix for freezing every window's typing on a slow query (CLAUDE.md
 * "Search") — checked by nothing.
 *
 * This bundles the real `searchWorker.ts` with esbuild into a throwaway file (`better-sqlite3` left
 * external: it is a native addon, not something esbuild can inline), points a `SearchClient` at it
 * through the test-only `workerPath` constructor argument, and asserts a query answers with actual
 * ids — not the `null` a client with no reachable worker would return.
 */
describe('SearchClient against the real worker thread', () => {
  let dir: string
  let workerDir: string
  let workerPath: string

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'apiary-searchworker-'))
    // Bundled *inside* node_modules/.cache, not the OS tmpdir above: `require('better-sqlite3')`
    // in the bundle resolves by walking up from the required file's own directory looking for a
    // `node_modules` beside it, and an OS tmpdir has no such ancestor. Left in .cache rather than
    // node_modules' own root so it can never collide with a real package name.
    mkdirSync(join(process.cwd(), 'node_modules', '.cache'), { recursive: true })
    workerDir = mkdtempSync(join(process.cwd(), 'node_modules', '.cache', 'apiary-searchworker-'))
    // `.cjs`, not `.js`: this repo is `"type": "module"`, so a `.js` file bundled as CommonJS
    // (`require('better-sqlite3')`) would be loaded as ESM by Node and fail on the bare `require`.
    workerPath = join(workerDir, 'searchWorker.cjs')
    await build({
      entryPoints: [join(process.cwd(), 'src/main/search/searchWorker.ts')],
      outfile: workerPath,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      external: ['better-sqlite3'],
      logLevel: 'silent',
    })
  }, 20000)

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
    rmSync(workerDir, { recursive: true, force: true })
  })

  it('runs a real content search in the worker and returns matching ids, not null', async () => {
    const dbPath = join(dir, 'search.db')
    const index = new SearchIndex(dbPath)
    index.put('session-1', 'remember the gitlab token rotation procedure', 40, Date.now())
    index.close()

    const client = new SearchClient(dbPath, workerPath)
    try {
      const ids = await client.search('rotation', { content: true, notes: false })
      expect(ids).not.toBeNull()
      expect(ids).toContain('session-1')
    } finally {
      await client.close()
    }
  })

  it('returns null, not an empty list, when the worker path does not exist', async () => {
    const dbPath = join(dir, 'search-missing.db')
    new SearchIndex(dbPath).close()
    const client = new SearchClient(dbPath, join(dir, 'no-such-worker.js'))
    try {
      const ids = await client.search('anything', { content: true, notes: false })
      expect(ids).toBeNull()
    } finally {
      await client.close()
    }
  })
})
