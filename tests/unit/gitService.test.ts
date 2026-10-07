import { terminalRef } from '@shared/domain/ids'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('../../src/main/git/branchOps', () => ({
  status: vi.fn(),
  listRefs: vi.fn(),
  checkoutBranch: vi.fn(),
  isWorktreeConflict: vi.fn(() => false),
  worktreeForBranch: vi.fn(),
  pull: vi.fn(),
  checkoutRemote: vi.fn(),
  checkoutDetached: vi.fn(),
  createBranch: vi.fn(),
  updateBranch: vi.fn(),
  pullFastForward: vi.fn(),
  listWorktrees: vi.fn(),
  push: vi.fn(),
  merge: vi.fn(),
  fetch: vi.fn(),
}))
vi.mock('../../src/main/plugins/remote', () => ({
  resolveRemote: vi.fn(async () => null),
}))

import * as branchOps from '../../src/main/git/branchOps'
import { GitService } from '../../src/main/git/gitService'
import { SessionResolver } from '../../src/main/sessions/sessionResolver'
import type { SessionStore } from '../../src/main/store/sessionStore'
import type { PtyManager } from '../../src/main/pty/ptyManager'

/** A resolver whose `resolveShellCwd`/`requireFolder` always answer with a real, existing
 *  directory — GitService itself does no filesystem checks, so the resolver only needs to hand
 *  back a stable cwd. */
function fakeResolver(cwd: string): SessionResolver {
  const store = { getSession: () => null, getProject: () => ({ path: cwd }), isRepoRootOfWorktree: () => false } as unknown as SessionStore
  const pty = { getCwd: () => cwd } as unknown as PtyManager
  return new SessionResolver({ store, pty })
}

describe('GitService', () => {
  let cwd: string
  let resolver: SessionResolver
  let git: GitService

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'apiary-gitservice-'))
    resolver = fakeResolver(cwd)
    git = new GitService({ resolver })
    vi.clearAllMocks()
  })

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true })
  })

  it('status() records the branch for lastBranchFor()', async () => {
    vi.mocked(branchOps.status).mockResolvedValue({ branch: 'main', ahead: 0, behind: 0, dirty: false } as never)
    await git.status(terminalRef('s1', true))
    expect(git.lastBranchFor(cwd)).toBe('main')
  })

  it('status() records a null branch when the folder is not a repo', async () => {
    vi.mocked(branchOps.status).mockResolvedValue(null)
    await git.status(terminalRef('s1', true))
    expect(git.lastBranchFor(cwd)).toBeNull()
  })

  it('lastBranchFor() is null for a folder never checked', () => {
    expect(git.lastBranchFor('/never/asked')).toBeNull()
  })

  it('checkoutBranch() returns ok on success', async () => {
    vi.mocked(branchOps.checkoutBranch).mockResolvedValue(undefined)
    await expect(git.checkoutBranch(terminalRef('s1', true), 'feature')).resolves.toEqual({ ok: true })
  })

  it('checkoutBranch() reports a worktree conflict as an outcome, not a throw', async () => {
    vi.mocked(branchOps.checkoutBranch).mockRejectedValue(new Error("branch 'feature' is checked out elsewhere"))
    vi.mocked(branchOps.isWorktreeConflict).mockReturnValue(true)
    vi.mocked(branchOps.worktreeForBranch).mockResolvedValue('/other/worktree')
    vi.mocked(branchOps.listWorktrees).mockResolvedValue([
      { path: cwd, branch: 'main' }, { path: '/other/worktree', branch: 'feature' }, { path: '/third', branch: 'release' },
    ])
    const entry = (name: string) => ({ name, relativeDate: '', author: '', shortSha: '', subject: '' })
    vi.mocked(branchOps.listRefs).mockResolvedValue({
      current: 'main', local: ['dev', 'main', 'feature', 'release', 'old'].map(entry), remote: [], tags: [],
    })
    const result = await git.checkoutBranch(terminalRef('s1', true), 'feature')
    // What the other worktree could move to: this folder's own branch (a swap), then every branch
    // checked out nowhere.
    expect(result).toEqual({
      ok: false,
      conflict: { branch: 'feature', worktreePath: '/other/worktree', label: 'worktree', current: 'main', choices: ['main', 'dev', 'old'] },
    })
  })

  it('checkoutBranch() rethrows a non-conflict failure', async () => {
    vi.mocked(branchOps.checkoutBranch).mockRejectedValue(new Error('boom'))
    vi.mocked(branchOps.isWorktreeConflict).mockReturnValue(false)
    await expect(git.checkoutBranch(terminalRef('s1', true), 'feature')).rejects.toThrow('boom')
  })

  it('mrRefStatus() maps every iid to null when there is no GitLab remote', async () => {
    const out = await git.mrRefStatus(terminalRef('s1', true), [1, 2])
    expect(out).toEqual({ 1: null, 2: null })
  })

  it('requireWorktreeFor() throws when git reports no worktree for the branch', async () => {
    vi.mocked(branchOps.worktreeForBranch).mockResolvedValue(null)
    await expect(git.requireWorktreeFor(terminalRef('s1', true), 'feature'))
      .rejects.toThrow('feature is no longer checked out in a worktree of this repository')
  })

  it('listWorktrees() remembers each returned worktree on the resolver', async () => {
    const otherDir = mkdtempSync(join(tmpdir(), 'apiary-gitservice-wt-'))
    vi.mocked(branchOps.listWorktrees).mockResolvedValue([{ path: otherDir, branch: 'b' }])
    const result = await git.listWorktrees(cwd)
    expect(result.map((w) => w.path)).toEqual([otherDir])
    expect(resolver.isKnownWorktree(otherDir)).toBe(true)
    rmSync(otherDir, { recursive: true, force: true })
  })
})
