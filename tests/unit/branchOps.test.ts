import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import {
  status, listRefs, checkoutBranch, checkoutRemote, checkoutDetached, createBranch, pull, push,
} from '../../src/main/git/branchOps'

let repo: string

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, stdio: 'pipe' }).toString()

function commit(repoPath: string, file: string, message: string): void {
  writeFileSync(join(repoPath, file), message)
  git(repoPath, 'add', '.')
  git(repoPath, '-c', 'commit.gpgsign=false', 'commit', '-qm', message)
}

beforeEach(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'apiary-branchops-')))
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'config', 'user.email', 'test@example.com')
  git(repo, 'config', 'user.name', 'Test')
  commit(repo, 'README.md', 'init')
})
afterEach(() => { rmSync(repo, { recursive: true, force: true }) })

describe('status', () => {
  it('reports the current branch with no upstream', async () => {
    const s = await status(repo)
    expect(s.branch).toBe('main')
    expect(s.hasUpstream).toBe(false)
    expect(s.ahead).toBe(0)
    expect(s.behind).toBe(0)
  })

  it('reports ahead/behind against a real upstream', async () => {
    const remote = mkdtempSync(join(tmpdir(), 'apiary-branchops-remote-'))
    git(remote, 'init', '-q', '--bare')
    git(repo, 'remote', 'add', 'origin', remote)
    git(repo, 'push', '-q', '-u', 'origin', 'main')
    commit(repo, 'a.txt', 'local-only commit') // makes local 1 ahead
    const s = await status(repo)
    expect(s.hasUpstream).toBe(true)
    expect(s.ahead).toBe(1)
    expect(s.behind).toBe(0)
    rmSync(remote, { recursive: true, force: true })
  })

  it('reports null branch when detached', async () => {
    const sha = git(repo, 'rev-parse', 'HEAD').trim()
    git(repo, 'checkout', '-q', '--detach', sha)
    const s = await status(repo)
    expect(s.branch).toBeNull()
  })

  it('throws when pointed at a non-git directory', async () => {
    const nonGitDir = realpathSync(mkdtempSync(join(tmpdir(), 'apiary-branchops-nonrepo-')))
    try {
      await status(nonGitDir)
      expect.fail('should have thrown')
    } catch (e) {
      expect((e as Error).message).toMatch(/not a git repository|fatal/i)
    } finally {
      rmSync(nonGitDir, { recursive: true, force: true })
    }
  })
})

describe('listRefs', () => {
  it('lists local branches, remote branches, and tags with metadata', async () => {
    git(repo, 'branch', 'feature/x')
    git(repo, 'tag', 'v1.0.0')
    const remote = mkdtempSync(join(tmpdir(), 'apiary-branchops-remote2-'))
    git(remote, 'init', '-q', '--bare')
    git(repo, 'remote', 'add', 'origin', remote)
    git(repo, 'push', '-q', 'origin', 'main')

    const refs = await listRefs(repo)
    expect(refs.current).toBe('main')
    expect(refs.local.map((r) => r.name)).toEqual(expect.arrayContaining(['main', 'feature/x']))
    expect(refs.remote.map((r) => r.name)).toEqual(expect.arrayContaining(['origin/main']))
    expect(refs.tags.map((r) => r.name)).toEqual(['v1.0.0'])
    const mainEntry = refs.local.find((r) => r.name === 'main')
    expect(mainEntry?.author).toBe('Test')
    expect(mainEntry?.subject).toBe('init')
    expect(mainEntry?.shortSha).toMatch(/^[0-9a-f]{4,}$/)
    rmSync(remote, { recursive: true, force: true })
  })
})

describe('checkoutBranch / createBranch', () => {
  it('checks out an existing local branch', async () => {
    git(repo, 'branch', 'feature/x')
    await checkoutBranch(repo, 'feature/x')
    expect((await status(repo)).branch).toBe('feature/x')
  })

  it('rejects an unknown branch with git\'s own error text', async () => {
    await expect(checkoutBranch(repo, 'nope')).rejects.toThrow(/nope/)
  })

  it('creates a new branch from HEAD', async () => {
    await createBranch(repo, 'feature/new')
    expect((await status(repo)).branch).toBe('feature/new')
  })

  it('creates a new branch from a given ref', async () => {
    git(repo, 'branch', 'base')
    commit(repo, 'b.txt', 'on main only')
    await createBranch(repo, 'from-base', 'base')
    expect((await status(repo)).branch).toBe('from-base')
    expect(git(repo, 'log', '--oneline').trim().split('\n')).toHaveLength(1) // only the init commit
  })
})

describe('checkoutRemote / checkoutDetached', () => {
  it('creates a local tracking branch from a remote ref', async () => {
    const remote = mkdtempSync(join(tmpdir(), 'apiary-branchops-remote3-'))
    git(remote, 'init', '-q', '--bare')
    git(repo, 'remote', 'add', 'origin', remote)
    git(repo, 'push', '-q', 'origin', 'main')
    git(repo, 'checkout', '-q', '-b', 'throwaway')
    git(repo, 'fetch', '-q')

    await checkoutRemote(repo, 'origin/main', 'main-local')
    expect((await status(repo)).branch).toBe('main-local')
    expect((await status(repo)).hasUpstream).toBe(true)
    rmSync(remote, { recursive: true, force: true })
  })

  it('checks out a tag detached', async () => {
    git(repo, 'tag', 'v1.0.0')
    await checkoutDetached(repo, 'v1.0.0')
    expect((await status(repo)).branch).toBeNull()
  })
})

describe('pull / push', () => {
  it('pulls new commits from the upstream', async () => {
    const remote = mkdtempSync(join(tmpdir(), 'apiary-branchops-remote4-'))
    git(remote, 'init', '-q', '--bare')
    git(repo, 'remote', 'add', 'origin', remote)
    git(repo, 'push', '-q', '-u', 'origin', 'main')

    const clone = mkdtempSync(join(tmpdir(), 'apiary-branchops-clone-'))
    git(tmpdir(), 'clone', '-q', remote, clone)
    git(clone, 'config', 'user.email', 'test@example.com')
    git(clone, 'config', 'user.name', 'Test')
    commit(clone, 'from-clone.txt', 'pushed from clone')
    git(clone, 'push', '-q')

    await pull(repo)
    expect(git(repo, 'log', '--oneline')).toContain('pushed from clone')
    rmSync(remote, { recursive: true, force: true })
    rmSync(clone, { recursive: true, force: true })
  })

  it('pushes and auto-sets upstream when none exists yet', async () => {
    const remote = mkdtempSync(join(tmpdir(), 'apiary-branchops-remote5-'))
    git(remote, 'init', '-q', '--bare')
    git(repo, 'remote', 'add', 'origin', remote)

    await push(repo)
    expect((await status(repo)).hasUpstream).toBe(true)
    rmSync(remote, { recursive: true, force: true })
  })

  it('rejects push with git\'s own error text when there is no remote at all', async () => {
    await expect(push(repo)).rejects.toThrow(/does not appear to be a git repository|No configured push destination/i)
  })

  it('surfaces the real CONFLICT text (from stdout) on a conflicting pull, not the harmless stderr fetch-progress line', async () => {
    const remote = mkdtempSync(join(tmpdir(), 'apiary-branchops-remote6-'))
    git(remote, 'init', '-q', '--bare')
    git(repo, 'remote', 'add', 'origin', remote)
    git(repo, 'push', '-q', '-u', 'origin', 'main')
    // Force an actual merge attempt (not git's "divergent branches, pick a strategy" refusal) so
    // the pull genuinely reaches a real conflict.
    git(repo, 'config', 'pull.rebase', 'false')

    // A second clone of the same remote, diverging from `repo` by editing the same line of the
    // same file — guarantees a real merge conflict (not just a fast-forward) on the eventual pull.
    const other = mkdtempSync(join(tmpdir(), 'apiary-branchops-other-'))
    git(tmpdir(), 'clone', '-q', remote, other)
    git(other, 'config', 'user.email', 'test@example.com')
    git(other, 'config', 'user.name', 'Test')
    writeFileSync(join(other, 'README.md'), 'change from other clone')
    git(other, 'add', '.')
    git(other, '-c', 'commit.gpgsign=false', 'commit', '-qm', 'conflicting change from other')
    git(other, 'push', '-q')

    writeFileSync(join(repo, 'README.md'), 'change from repo')
    git(repo, 'add', '.')
    git(repo, '-c', 'commit.gpgsign=false', 'commit', '-qm', 'conflicting change from repo')

    await expect(pull(repo)).rejects.toThrow(/conflict/i)

    rmSync(remote, { recursive: true, force: true })
    rmSync(other, { recursive: true, force: true })
  })
})
