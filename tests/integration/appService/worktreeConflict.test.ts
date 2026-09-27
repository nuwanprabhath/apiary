import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { realpathSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import type { AppService } from '../../../src/main/appService'
import { makeSession } from '../../fixtures/makeSession'
import { createServiceFixture, teardownServiceFixture, git, makeGitWorkdir } from './setup'

let home: string
let workdir: string
let service: AppService

beforeEach(() => {
  ;({ home, workdir, service } = createServiceFixture())
})
afterEach(async () => {
  await teardownServiceFixture({ home, workdir, service })
})

const projects = (): string => join(home, '.claude', 'projects')
describe('checking out a branch another worktree already has', () => {
  /** A repo with a session in it, plus a worktree holding `branch`. */
  async function repoWithWorktree(branch: string, sessionId: string) {
    const dir = makeGitWorkdir()
    const worktree = realpathSync(mkdtempSync(join(tmpdir(), 'apiary-wt-')))
    rmSync(worktree, { recursive: true, force: true })
    git(dir, 'worktree', 'add', '-q', '-b', branch, worktree)
    makeSession(projects(), '-w', { sessionId, cwd: dir, title: 'Git session' })
    await service.refresh()
    await service.importSessions([sessionId], [])
    return { dir, worktree }
  }

  it('reports where the branch actually is, instead of failing with git\'s sentence', async () => {
    // Being told "fatal: 'dev/1.0.12' is already used by worktree at '/…'" and left to go and
    // find that directory by hand is the slow part this replaces.
    const id = '88888888-8888-8888-8888-888888888888'
    const { dir, worktree } = await repoWithWorktree('dev/1.0.12', id)
    try {
      const outcome = await service.gitCheckoutBranch(id, false, 'dev/1.0.12')

      expect(outcome.ok).toBe(false)
      if (outcome.ok) throw new Error('expected a conflict')
      expect(outcome.conflict.branch).toBe('dev/1.0.12')
      expect(outcome.conflict.worktreePath).toBe(worktree)
      expect(outcome.conflict.label).toBe(basename(worktree))
    } finally {
      git(dir, 'worktree', 'remove', '--force', worktree)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('still fails outright for a branch that does not exist', async () => {
    // Only the "it is open somewhere else" refusal is an outcome; everything else is an error.
    const id = '99999999-9999-9999-9999-999999999999'
    const { dir, worktree } = await repoWithWorktree('dev/1.0.13', id)
    try {
      await expect(service.gitCheckoutBranch(id, false, 'no-such-branch')).rejects.toThrow()
    } finally {
      git(dir, 'worktree', 'remove', '--force', worktree)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('starts a new session in that worktree, in the worktree\'s own directory', async () => {
    const id = 'aaaaaaaa-8888-8888-8888-888888888888'
    const { dir, worktree } = await repoWithWorktree('dev/1.0.14', id)
    try {
      const info = await service.newSessionInWorktree(id, false, 'dev/1.0.14')
      expect(info.cwd).toBe(worktree)
      expect(service.pty.has(info.ptyId)).toBe(true)
    } finally {
      await service.pty.killAll()
      git(dir, 'worktree', 'remove', '--force', worktree)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses to act on a branch whose worktree has since gone', async () => {
    const id = 'bbbbbbbb-8888-8888-8888-888888888888'
    const { dir, worktree } = await repoWithWorktree('dev/1.0.15', id)
    git(dir, 'worktree', 'remove', '--force', worktree)
    try {
      await expect(service.gitPullWorktree(id, false, 'dev/1.0.15'))
        .rejects.toThrow(/no longer checked out/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
