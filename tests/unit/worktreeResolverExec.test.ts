import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  setExecForTesting, resolveProject, clearResolverCache, resetResolverSpawnCount, resolverSpawnCount,
} from '../../src/main/git/worktreeResolver'

/**
 * MAIN-23: `worktreeResolver.ts` now runs `git` through the shared `exec/run.ts` wrapper. This
 * pins its contract, unchanged from before the migration and the opposite of `branchOps.ts`'s: a
 * failing spawn resolves to `null` (best-effort project detection), never throws.
 * `tests/integration/worktreeResolver.test.ts` (real git) covers the actual resolution logic.
 */
describe('worktreeResolver exec wrapper (MAIN-23)', () => {
  let dir: string

  afterEach(() => {
    setExecForTesting(null)
    resetResolverSpawnCount()
    clearResolverCache()
    rmSync(dir, { recursive: true, force: true })
  })

  it('a failing git spawn resolves the folder as "not a repository" rather than throwing', async () => {
    dir = mkdtempSync(join(tmpdir(), 'apiary-resolver-exec-'))
    setExecForTesting(async () => { throw new Error('not a git repository') })
    const info = await resolveProject(dir)
    expect(info.repoRoot).toBeNull()
    expect(info.isWorktree).toBe(false)
    expect(info.exists).toBe(true)
  })

  it('still counts a spawn when the exec fails', async () => {
    dir = mkdtempSync(join(tmpdir(), 'apiary-resolver-exec-'))
    resetResolverSpawnCount()
    setExecForTesting(async () => { throw new Error('boom') })
    await resolveProject(dir)
    expect(resolverSpawnCount()).toBeGreaterThan(0)
  })
})
