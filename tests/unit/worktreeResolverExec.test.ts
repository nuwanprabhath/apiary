import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorktreeResolver } from '../../src/main/git/worktreeResolver'

/**
 * MAIN-23: `WorktreeResolver` runs `git` through the shared `exec/run.ts` wrapper it is given. This
 * pins its contract, the opposite of `BranchOps`'s: a failing spawn resolves to `null` (best-effort
 * project detection), never throws. `tests/integration/worktreeResolver.test.ts` (real git) covers
 * the actual resolution logic. Each test builds its own resolver, so no cache or counter leaks.
 */
describe('WorktreeResolver exec wrapper (MAIN-23)', () => {
  let dir: string

  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('a failing git spawn resolves the folder as "not a repository" rather than throwing', async () => {
    dir = mkdtempSync(join(tmpdir(), 'apiary-resolver-exec-'))
    const resolver = new WorktreeResolver({ exec: async () => { throw new Error('not a git repository') } })
    const info = await resolver.resolveProject(dir)
    expect(info.repoRoot).toBeNull()
    expect(info.isWorktree).toBe(false)
    expect(info.exists).toBe(true)
  })

  it('still counts a spawn when the exec fails', async () => {
    dir = mkdtempSync(join(tmpdir(), 'apiary-resolver-exec-'))
    const resolver = new WorktreeResolver({ exec: async () => { throw new Error('boom') } })
    await resolver.resolveProject(dir)
    expect(resolver.spawnCount()).toBeGreaterThan(0)
    resolver.resetSpawnCount()
    expect(resolver.spawnCount()).toBe(0)
  })

  it('answers a second ask for the same folder from its cache, until the cache is cleared', async () => {
    dir = mkdtempSync(join(tmpdir(), 'apiary-resolver-exec-'))
    const resolver = new WorktreeResolver({ exec: async () => { throw new Error('boom') } })
    await resolver.resolveProject(dir)
    const spawned = resolver.spawnCount()
    await resolver.resolveProject(dir)
    expect(resolver.spawnCount()).toBe(spawned)
    resolver.clearCache()
    await resolver.resolveProject(dir)
    expect(resolver.spawnCount()).toBeGreaterThan(spawned)
  })
})
