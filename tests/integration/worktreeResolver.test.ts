import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, realpathSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { git, initRepo } from '../fixtures/gitRepo'
import { WorktreeResolver, createResolverExec } from '../../src/main/git/worktreeResolver'

let base: string
let resolver: WorktreeResolver
const resolveProject = (...args: Parameters<WorktreeResolver['resolveProject']>) => resolver.resolveProject(...args)

beforeEach(() => {
  // realpath: on macOS os.tmpdir() is under /var, a symlink to /private/var, while git
  // resolves absolute paths (--show-toplevel, and --git-common-dir for worktrees) to the
  // real path. Canonicalizing here keeps our expectations and git's output comparable.
  base = realpathSync(mkdtempSync(join(tmpdir(), 'apiary-git-')))
  resolver = new WorktreeResolver({ exec: createResolverExec() })
})
afterEach(() => { rmSync(base, { recursive: true, force: true }) })

function makeRepo(): string {
  return initRepo(join(base, 'repo'), { readme: 'hi' })
}

describe('resolveProject', () => {
  it('identifies a plain repo as its own root', async () => {
    const repo = makeRepo()
    const info = await resolveProject(repo)
    expect(info.isWorktree).toBe(false)
    expect(info.repoRoot).toBe(repo)
    expect(info.branch).toBe('main')
    expect(info.exists).toBe(true)
  })

  it('identifies a worktree and points at the parent repo', async () => {
    const repo = makeRepo()
    const wt = join(base, 'wt-1.0.11')
    git(repo, 'worktree', 'add', '-q', '-b', 'rel/1.0.11', wt)
    const info = await resolveProject(wt)
    expect(info.isWorktree).toBe(true)
    expect(info.repoRoot).toBe(repo)
    expect(info.branch).toBe('rel/1.0.11')
  })

  it('a repository with no commits yet is still a repository, with no branch reported as unusual', async () => {
    const repo = join(base, 'unborn')
    mkdirSync(repo)
    git(repo, 'init', '-q', '-b', 'main')
    const info = await resolveProject(repo)
    expect(info.isWorktree).toBe(false)
    expect(info.repoRoot).toBe(repo)
    // `symbolic-ref` succeeds on an unborn branch (unlike `rev-parse --abbrev-ref HEAD`, which
    // would report "HEAD" here) — this is the case MAIN-3's single-spawn rewrite must not misread
    // as "not a repository".
    expect(info.branch).toBe('main')
  })

  it('a detached HEAD has no branch', async () => {
    const repo = makeRepo()
    const sha = git(repo, 'rev-parse', 'HEAD').trim()
    git(repo, 'checkout', '-q', sha)
    const info = await resolveProject(repo)
    expect(info.isWorktree).toBe(false)
    expect(info.branch).toBeNull()
  })

  it('reports a non-git directory with no repo root', async () => {
    const plain = join(base, 'plain')
    mkdirSync(plain)
    const info = await resolveProject(plain)
    expect(info.isWorktree).toBe(false)
    expect(info.repoRoot).toBeNull()
    expect(info.exists).toBe(true)
  })

  it('marks a missing directory as not existing', async () => {
    const info = await resolveProject(join(base, 'gone'))
    expect(info.exists).toBe(false)
    expect(info.repoRoot).toBeNull()
  })

  it('does not misclassify a plain repo reached through a symlink', async () => {
    const repo = makeRepo()
    const alias = join(base, 'alias-to-repo')
    symlinkSync(repo, alias)
    // Guard against the symlink coinciding with its target (e.g. a platform that resolves
    // it eagerly) — the test would silently stop exercising the symlink path otherwise.
    expect(realpathSync(alias)).not.toBe(alias)
    expect(realpathSync(alias)).toBe(repo)

    const info = await resolveProject(alias)
    expect(info.isWorktree).toBe(false)
    expect(info.repoRoot).toBe(repo)
  })

  it('resolves a worktree reached through a symlink to the same canonical repoRoot as the parent', async () => {
    const repo = makeRepo()
    const wt = join(base, 'wt-1.0.12')
    git(repo, 'worktree', 'add', '-q', '-b', 'rel/1.0.12', wt)
    const wtAlias = join(base, 'alias-to-wt')
    symlinkSync(wt, wtAlias)
    expect(realpathSync(wtAlias)).not.toBe(wtAlias)

    // The parent must also be reached through a symlinked alias — repoRoot is what a worktree
    // reports about its parent, but the thing it needs to match is the parent's own resolved
    // `path`. Keeping the parent's path canonical here would let this pass even if repoRoot and
    // path lived in different domains, since they'd coincidentally already be equal strings.
    const repoAlias = join(base, 'alias-to-repo-for-parent')
    symlinkSync(repo, repoAlias)
    expect(realpathSync(repoAlias)).not.toBe(repoAlias)

    const wtInfo = await resolveProject(wtAlias)
    const parentInfo = await resolveProject(repoAlias)
    expect(wtInfo.isWorktree).toBe(true)
    expect(wtInfo.repoRoot).toBe(parentInfo.path)
  })
})

describe('the cache is keyed by the folder\'s HEAD (MAIN-1)', () => {
  it('shows a branch checked out outside Apiary on the next resolve, without a full pass', async () => {
    const repo = makeRepo()
    expect((await resolveProject(repo)).branch).toBe('main')
    git(repo, 'checkout', '-q', '-b', 'feature/outside')
    expect((await resolveProject(repo)).branch).toBe('feature/outside')
  })

  it('does the same for a linked worktree, whose HEAD lives in the repo\'s .git/worktrees', async () => {
    const repo = makeRepo()
    const wt = join(base, 'wt-head')
    git(repo, 'worktree', 'add', '-q', '-b', 'rel/a', wt)
    expect((await resolveProject(wt)).branch).toBe('rel/a')
    git(wt, 'checkout', '-q', '-b', 'rel/b')
    expect((await resolveProject(wt)).branch).toBe('rel/b')
  })

  it('still answers from the cache, with no git spawn, while HEAD is untouched', async () => {
    const repo = makeRepo()
    await resolveProject(repo)
    resolver.resetSpawnCount()
    await resolveProject(repo)
    await resolveProject(repo)
    expect(resolver.spawnCount()).toBe(0)
  })
})
