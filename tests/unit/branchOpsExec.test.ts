import { describe, it, expect } from 'vitest'
import { BranchOps } from '../../src/main/git/branchOps'
import type { ExecFn } from '../../src/main/exec/run'

/**
 * MAIN-23: `BranchOps` runs `git` through the shared `exec/run.ts` wrapper it is given. This pins
 * the two things that must not change: a failure still throws (never swallowed to null — that is
 * `WorktreeResolver`'s contract, not this one's), and every call still counts as a spawn.
 * `tests/integration/branchOps.test.ts` (real git) covers the actual git semantics; this covers
 * only the wrapper seam, with a fake `ExecFn` and an instance of its own — no module state to reset.
 */
describe('BranchOps exec wrapper (MAIN-23)', () => {
  const failing = (message: string): ExecFn => async () => { throw new Error(message) }

  it('propagates a rejection from the injected exec unchanged', async () => {
    const ops = new BranchOps({ exec: failing('normalised failure text') })
    await expect(ops.fetch('/some/repo')).rejects.toThrow('normalised failure text')
  })

  it('counts a spawn even when the exec ultimately fails', async () => {
    const ops = new BranchOps({ exec: failing('boom') })
    await ops.fetch('/some/repo').catch(() => {})
    expect(ops.spawnCount()).toBe(1)
  })

  it('calls the injected exec with "git" and the expected args and cwd', async () => {
    let seen: { file: string; args: string[]; cwd: string } | undefined
    const ops = new BranchOps({ exec: async (file, args, cwd) => { seen = { file, args, cwd }; return '' } })
    await ops.fetch('/some/repo')
    expect(seen).toEqual({ file: 'git', args: ['fetch', '--prune'], cwd: '/some/repo' })
  })

  it('two instances count separately', async () => {
    const a = new BranchOps({ exec: async () => '' })
    const b = new BranchOps({ exec: async () => '' })
    await a.fetch('/r')
    expect([a.spawnCount(), b.spawnCount()]).toEqual([1, 0])
  })
})
