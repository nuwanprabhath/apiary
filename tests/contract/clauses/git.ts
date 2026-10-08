import { describe, expect, it } from 'vitest'
import { STANDARD_SESSIONS as STD } from '../../fixtures/standard'
import { sessionOf, type Ctx } from '../support'

/** The repository's main checkout (on `main`), its worktree (on `feature/wt`), and a plain folder. */
export const REPO = { kind: 'session', id: STD.repoRoot.id } as const
export const WORKTREE = { kind: 'session', id: STD.worktree.id } as const
export const PLAIN = { kind: 'session', id: STD.csv.id } as const

export function defineGitClauses(ctx: Ctx): void {
  const names = async (target: typeof REPO | typeof WORKTREE | typeof PLAIN): Promise<{ current: string | null; local: string[]; remote: string[] }> => {
    const refs = await ctx.api.gitListRefs(target)
    return { current: refs.current, local: refs.local.map((r) => r.name).sort(), remote: refs.remote.map((r) => r.name).sort() }
  }
  const branchInTree = async (id: string): Promise<string | null | undefined> => sessionOf(await ctx.api.tree(), id)?.session.gitBranch === undefined
    ? undefined
    : sessionOf(await ctx.api.tree(), id)?.folder.branch

  describe('git: reading', () => {
    it('reports a folder\'s branch and how far it is from its upstream, and nothing for a folder that is not a repository', async () => {
      expect(await ctx.api.gitStatus(REPO)).toEqual({ branch: 'main', ahead: 0, behind: 0, hasUpstream: true })
      expect(await ctx.api.gitStatus(WORKTREE)).toEqual({ branch: 'feature/wt', ahead: 0, behind: 0, hasUpstream: false })
      expect(await ctx.api.gitStatus(PLAIN)).toBeNull()
    })

    it('lists the branches of each checkout: local, on the remote, and which one is current', async () => {
      // The repository has `origin/HEAD` (a symbolic ref to `origin/main`); it is an alias, never a branch to offer, and
      // git's short form of it is a bare "origin" (B20).
      expect(await names(REPO)).toEqual({ current: 'main', local: ['feature/wt', 'main'], remote: ['origin/main', 'origin/release/1'] })
      expect((await names(REPO)).remote).not.toContain('origin')
      expect((await names(WORKTREE)).current).toBe('feature/wt')
      expect((await ctx.api.gitListRefs(REPO)).tags).toEqual([])
    })

    it('resolves no merge request for a repository with no GitLab remote', async () => {
      expect(await ctx.api.gitlabMrRefStatus(REPO, [12, 34])).toEqual({ 12: null, 34: null })
    })
  })

  describe('git: changing branch', () => {
    it('creating a branch checks it out, lists it, shows it in the tree, and signals the tree changed', async () => {
      await ctx.api.gitCreateBranch(REPO, 'feature/contract')
      const refs = await ctx.api.gitListRefs(REPO)
      expect(refs.current).toBe('feature/contract')
      expect(refs.local.map((r) => r.name)).toContain('feature/contract')
      expect(ctx.heard.count('treeChanged')).toBeGreaterThan(0)
      expect(await branchInTree(STD.repoRoot.id)).toBe('feature/contract')
      // The other checkout is not moved by it.
      expect((await names(WORKTREE)).current).toBe('feature/wt')
    })

    it('checks out a branch that is free, and refuses one that does not exist', async () => {
      await ctx.api.gitCreateBranch(REPO, 'spare')
      expect(await ctx.api.gitCheckoutBranch(REPO, 'main')).toEqual({ ok: true })
      expect((await names(REPO)).current).toBe('main')
      expect(await branchInTree(STD.repoRoot.id)).toBe('main')
      expect(ctx.heard.count('treeChanged')).toBeGreaterThan(0)
      await expect(ctx.api.gitCheckoutBranch(REPO, 'no-such-branch')).rejects.toThrow()
      expect((await names(REPO)).current).toBe('main')
    })

    it('a branch another worktree has is an outcome, not an error: it names the branch and where it is, offers where that worktree could go, and changes nothing', async () => {
      await ctx.api.gitCreateBranch(REPO, 'spare')
      await ctx.api.gitCheckoutBranch(REPO, 'main')
      ctx.heard.reset()
      const outcome = await ctx.api.gitCheckoutBranch(REPO, 'feature/wt')
      expect(outcome.ok).toBe(false)
      if (outcome.ok) throw new Error('expected a conflict')
      expect(outcome.conflict).toMatchObject({ branch: 'feature/wt', label: 'repo-c-wt', current: 'main', choices: ['main', 'spare'] })
      expect((await names(REPO)).current).toBe('main')
      expect(ctx.heard.count('treeChanged')).toBe(0)
    })

    it('moves the other worktree to another branch and takes its branch, in one go, for both checkouts', async () => {
      await ctx.api.gitCreateBranch(REPO, 'spare')
      await ctx.api.gitCheckoutBranch(REPO, 'main')
      ctx.heard.reset()
      await ctx.api.gitCheckoutBranchMovingOther(REPO, 'feature/wt', 'spare')
      expect((await names(REPO)).current).toBe('feature/wt')
      expect((await names(WORKTREE)).current).toBe('spare')
      expect(await branchInTree(STD.repoRoot.id)).toBe('feature/wt')
      expect(await branchInTree(STD.worktree.id)).toBe('spare')
      expect(ctx.heard.count('treeChanged')).toBeGreaterThan(0)
    })

    it('can swap with the other worktree', async () => {
      await ctx.api.gitCheckoutBranchMovingOther(REPO, 'feature/wt', 'main')
      expect((await names(REPO)).current).toBe('feature/wt')
      expect((await names(WORKTREE)).current).toBe('main')
    })

    it('checks out a ref with no branch (detached), after which the folder has no current branch', async () => {
      await ctx.api.gitCheckoutDetached(REPO, 'main')
      expect((await names(REPO)).current).toBeNull()
      expect((await ctx.api.gitStatus(REPO))?.branch).toBeNull()
      expect(await branchInTree(STD.repoRoot.id)).toBeNull()
      expect(ctx.heard.count('treeChanged')).toBeGreaterThan(0)
      await ctx.api.gitCheckoutBranch(REPO, 'main')
      expect((await names(REPO)).current).toBe('main')
    })

    it('makes a local branch of a remote one and checks it out', async () => {
      await ctx.api.gitCheckoutRemote(REPO, 'origin/release/1', 'release/1')
      const refs = await names(REPO)
      expect(refs.current).toBe('release/1')
      expect(refs.local).toContain('release/1')
      expect(ctx.heard.count('treeChanged')).toBeGreaterThan(0)
    })

    it('merging a branch signals the tree; a ref that does not exist is an error', async () => {
      await ctx.api.gitMerge(REPO, 'feature/wt')
      expect(ctx.heard.count('treeChanged')).toBe(1)
      await expect(ctx.api.gitMerge(REPO, 'no-such-ref')).rejects.toThrow()
    })

    it('refuses to change the branch of a folder that is not a repository', async () => {
      await expect(ctx.api.gitCreateBranch(PLAIN, 'nope')).rejects.toThrow()
      await expect(ctx.api.gitCheckoutBranch(PLAIN, 'main')).rejects.toThrow()
    })
  })

  describe('git: the remote', () => {
    it('a fetch brings in what others pushed without changing anything here, and says the tree may have changed', async () => {
      await ctx.bridge.outside.advanceRemote()
      expect(await ctx.api.gitStatus(REPO)).toMatchObject({ ahead: 0, behind: 0 })
      await ctx.api.gitFetch(REPO)
      expect(await ctx.api.gitStatus(REPO)).toMatchObject({ ahead: 0, behind: 1 })
      expect(ctx.heard.count('treeChanged')).toBe(1)
    })

    it('a pull brings the branch up to date and says how many commits that was', async () => {
      expect(await ctx.api.gitPull(REPO)).toEqual({ commits: 0 })
      await ctx.bridge.outside.advanceRemote()
      expect(await ctx.api.gitPull(REPO)).toEqual({ commits: 1 })
      expect(await ctx.api.gitStatus(REPO)).toMatchObject({ ahead: 0, behind: 0 })
    })

    it('a push sends the commits made here and says how many', async () => {
      expect(await ctx.api.gitPush(REPO)).toEqual({ commits: 0, published: false })
      await ctx.bridge.outside.commitLocally()
      expect(await ctx.api.gitStatus(REPO)).toMatchObject({ ahead: 1, behind: 0 })
      expect(await ctx.api.gitPush(REPO)).toEqual({ commits: 1, published: false })
      expect(await ctx.api.gitStatus(REPO)).toMatchObject({ ahead: 0, behind: 0 })
    })

    it('pushing a branch the remote has never seen publishes it, after which it has an upstream', async () => {
      expect(await ctx.api.gitPush(WORKTREE)).toEqual({ commits: 0, published: true })
      expect(await ctx.api.gitStatus(WORKTREE)).toMatchObject({ branch: 'feature/wt', hasUpstream: true })
      expect((await names(REPO)).remote).toContain('origin/feature/wt')
    })

    it('brings another branch up to date from where it is checked out, and a folder\'s own branch from its hover card', async () => {
      await ctx.bridge.outside.advanceRemote()
      await ctx.api.gitFetch(WORKTREE)
      // `main` lives in the other checkout; asking from the worktree still updates it.
      expect(await ctx.api.gitUpdateBranch(WORKTREE, 'main')).toEqual({ commits: 1 })
      expect(await ctx.api.gitStatus(REPO)).toMatchObject({ behind: 0 })
      expect(await ctx.api.gitUpdateBranch(WORKTREE, 'main')).toEqual({ commits: 0 })

      await ctx.bridge.outside.advanceRemote()
      ctx.heard.reset()
      expect(await ctx.api.gitPullFolder(ctx.bridge.folders.repo)).toEqual({ commits: 1 })
      expect(ctx.heard.count('treeChanged')).toBe(1)
      expect(await ctx.api.gitPullFolder(ctx.bridge.folders.repo)).toEqual({ commits: 0 })
      expect(ctx.heard.count('treeChanged')).toBe(1)
      await expect(ctx.api.gitPullFolder('/no/such/folder')).rejects.toThrow()
    })

    it('pulls a branch in the worktree that has it, and refuses a branch no worktree has', async () => {
      await ctx.api.gitPush(WORKTREE)
      ctx.heard.reset()
      const pulled = await ctx.api.gitPullWorktree(REPO, 'feature/wt')
      expect(pulled.commits).toBe(0)
      expect(typeof pulled.path).toBe('string')
      expect(ctx.heard.count('treeChanged')).toBe(1)
      await expect(ctx.api.gitPullWorktree(REPO, 'release/1')).rejects.toThrow()
    })
  })
}
