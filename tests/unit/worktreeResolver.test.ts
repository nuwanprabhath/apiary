import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, realpathSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { resolveProject, clearResolverCache } from '../../src/main/git/worktreeResolver'

let base: string
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, stdio: 'pipe' }).toString()

beforeEach(() => {
  // realpath: on macOS os.tmpdir() is under /var, a symlink to /private/var, while git
  // resolves absolute paths (--show-toplevel, and --git-common-dir for worktrees) to the
  // real path. Canonicalizing here keeps our expectations and git's output comparable.
  base = realpathSync(mkdtempSync(join(tmpdir(), 'apiary-git-')))
  clearResolverCache()
})
afterEach(() => { rmSync(base, { recursive: true, force: true }) })

function makeRepo(): string {
  const repo = join(base, 'repo')
  mkdirSync(repo)
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'config', 'user.email', 'test@example.com')
  git(repo, 'config', 'user.name', 'Test')
  writeFileSync(join(repo, 'README.md'), 'hi')
  git(repo, 'add', '.')
  git(repo, 'commit', '-qm', 'init')
  return repo
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
