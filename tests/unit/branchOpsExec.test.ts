import { describe, it, expect, afterEach } from 'vitest'
import { setExecForTesting, branchOpsSpawnCount, resetBranchOpsSpawnCount, fetch } from '../../src/main/git/branchOps'

/**
 * MAIN-23: `branchOps.ts` now runs `git` through the shared `exec/run.ts` wrapper instead of its
 * own `promisify(execFile)`. This pins the two things that must not change: a failure still
 * throws (never swallowed to null — that is `worktreeResolver`'s contract, not this one's), and
 * every call still counts as a spawn. `tests/integration/branchOps.test.ts` (real git, 42 tests)
 * covers the actual git semantics; this covers only the wrapper seam, with a fake `ExecFn`.
 */
describe('branchOps exec wrapper (MAIN-23)', () => {
  afterEach(() => {
    setExecForTesting(null)
    resetBranchOpsSpawnCount()
  })

  it('propagates a rejection from the injected exec unchanged', async () => {
    setExecForTesting(async () => { throw new Error('normalised failure text') })
    await expect(fetch('/some/repo')).rejects.toThrow('normalised failure text')
  })

  it('counts a spawn even when the exec ultimately fails', async () => {
    resetBranchOpsSpawnCount()
    setExecForTesting(async () => { throw new Error('boom') })
    await fetch('/some/repo').catch(() => {})
    expect(branchOpsSpawnCount()).toBe(1)
  })

  it('calls the injected exec with "git" and the expected args and cwd', async () => {
    let seen: { file: string; args: string[]; cwd: string } | undefined
    setExecForTesting(async (file, args, cwd) => {
      seen = { file, args, cwd }
      return ''
    })
    await fetch('/some/repo')
    expect(seen).toEqual({ file: 'git', args: ['fetch', '--prune'], cwd: '/some/repo' })
  })
})
