import { describe, expect, it } from 'vitest'
import { isPendingPtyId } from '@shared/domain/ptyId'
import type { Ctx } from '../support'
import { REPO } from './git'

export function defineWorktreeClauses(ctx: Ctx): void {
  const branchesOf = async (path: string): Promise<(string | null)[]> => (await ctx.api.listWorktrees(path)).map((w) => w.branch)

  describe('worktrees', () => {
    it('lists the other worktrees of a folder\'s repository by branch, none for a folder that is not one, and refuses a folder it does not know', async () => {
      expect(await branchesOf(ctx.bridge.folders.repo)).toEqual(['feature/wt'])
      expect(await branchesOf(ctx.bridge.folders.workA)).toEqual([])
      await expect(ctx.api.listWorktrees('/no/such/folder')).rejects.toThrow()
    })

    it('offers the New worktree dialog the branches, the ones already checked out and the names taken', async () => {
      const options = await ctx.api.worktreeCreateOptions(ctx.bridge.folders.repo)
      expect([...options.local].sort()).toEqual(['feature/wt', 'main'])
      // With `origin/HEAD` set the remote's alias is not a branch: no bare "origin" (B20).
      expect([...options.remote].sort()).toEqual(['origin/main', 'origin/release/1'])
      expect([...options.checkedOut].sort()).toEqual(['feature/wt', 'main'])
      expect(options.existingNames).toEqual([])
      await expect(ctx.api.worktreeCreateOptions('/no/such/folder')).rejects.toThrow()
    })

    it('starts a session in the worktree that has a branch, and refuses a branch no worktree has', async () => {
      const info = await ctx.api.newSessionInWorktree(REPO, 'feature/wt')
      expect(isPendingPtyId(info.ptyId)).toBe(true)
      expect(info.label).toBe('repo-c-wt')
      await expect(ctx.api.newSessionInWorktree(REPO, 'release/1')).rejects.toThrow()
    })

    it('creates a worktree on a new branch and starts a session in it, which the folder then lists', async () => {
      const info = await ctx.api.worktreeCreate(ctx.bridge.folders.repo, { name: ' extra ', branch: { kind: 'new', branch: 'feature/extra' } })
      expect(isPendingPtyId(info.ptyId)).toBe(true)
      expect(info.label).toBe('extra')
      expect((await branchesOf(ctx.bridge.folders.repo)).sort()).toEqual(['feature/extra', 'feature/wt'])
      const options = await ctx.api.worktreeCreateOptions(ctx.bridge.folders.repo)
      expect(options.existingNames).toEqual(['extra'])
      expect(options.local).toContain('feature/extra')
      expect(options.checkedOut).toContain('feature/extra')
    })

    it('creates a worktree on a remote branch, as a local branch of the same name', async () => {
      await ctx.api.worktreeCreate(ctx.bridge.folders.repo, { name: 'release', branch: { kind: 'remote', ref: 'origin/release/1' } })
      expect((await branchesOf(ctx.bridge.folders.repo)).sort()).toEqual(['feature/wt', 'release/1'])
    })

    it('refuses a name that is taken or unusable, a branch that is checked out elsewhere, and a branch that already exists', async () => {
      const repo = ctx.bridge.folders.repo
      await ctx.api.worktreeCreate(repo, { name: 'extra', branch: { kind: 'new', branch: 'feature/extra' } })
      await expect(ctx.api.worktreeCreate(repo, { name: 'extra', branch: { kind: 'new', branch: 'feature/other' } })).rejects.toThrow()
      await expect(ctx.api.worktreeCreate(repo, { name: '', branch: { kind: 'new', branch: 'feature/other' } })).rejects.toThrow()
      await expect(ctx.api.worktreeCreate(repo, { name: 'a/b', branch: { kind: 'new', branch: 'feature/other' } })).rejects.toThrow()
      await expect(ctx.api.worktreeCreate(repo, { name: 'third', branch: { kind: 'local', branch: 'feature/wt' } })).rejects.toThrow()
      await expect(ctx.api.worktreeCreate(repo, { name: 'fourth', branch: { kind: 'new', branch: 'main' } })).rejects.toThrow()
      expect((await branchesOf(repo)).sort()).toEqual(['feature/extra', 'feature/wt'])
    })
  })
}
