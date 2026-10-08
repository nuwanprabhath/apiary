import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, realpathSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { git, commitFile as commit, initRepo, setIdentity } from '../fixtures/gitRepo'
import { BranchOps, createBranchExec, parseWorktreeList, isWorktreeConflict } from '../../src/main/git/branchOps'
import type { GitStatus } from '@shared/types'

const ops = new BranchOps({ exec: createBranchExec() })

/** `status()` returns `GitStatus | null` (MAIN-9: null means "not a repository", an outcome these
 *  tests never exercise via this helper — see the dedicated non-git-directory test below). */
async function requireStatus(cwd: string): Promise<GitStatus> {
  const s = await ops.status(cwd)
  if (s === null) throw new Error('expected a git status, got null (not a repository?)')
  return s
}

let repo: string


beforeEach(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'apiary-branchops-')))
  initRepo(repo)
})
afterEach(() => { rmSync(repo, { recursive: true, force: true }) })

describe('status', () => {
  it('reports the current branch with no upstream', async () => {
    const s = await requireStatus(repo)
    expect(s.branch).toBe('main')
    expect(s.hasUpstream).toBe(false)
    expect(s.ahead).toBe(0)
    expect(s.behind).toBe(0)
  })

  it('reports ahead/behind against a real upstream', async () => {
    const remote = mkdtempSync(join(tmpdir(), 'apiary-branchops-remote-'))
    git(remote, 'init', '-q', '--bare', '-b', 'main')
    git(repo, 'remote', 'add', 'origin', remote)
    git(repo, 'push', '-q', '-u', 'origin', 'main')
    commit(repo, 'a.txt', 'local-only commit') // makes local 1 ahead
    const s = await requireStatus(repo)
    expect(s.hasUpstream).toBe(true)
    expect(s.ahead).toBe(1)
    expect(s.behind).toBe(0)
    rmSync(remote, { recursive: true, force: true })
  })

  it('reports null branch when detached', async () => {
    const sha = git(repo, 'rev-parse', 'HEAD').trim()
    git(repo, 'checkout', '-q', '--detach', sha)
    const s = await requireStatus(repo)
    expect(s.branch).toBeNull()
  })

  it('resolves null when pointed at a non-git directory, rather than rejecting (MAIN-9)', async () => {
    const nonGitDir = realpathSync(mkdtempSync(join(tmpdir(), 'apiary-branchops-nonrepo-')))
    try {
      await expect(ops.status(nonGitDir)).resolves.toBeNull()
    } finally {
      rmSync(nonGitDir, { recursive: true, force: true })
    }
  })

  describe('spawn count (MAIN-9: measured before fixing)', () => {
    it('costs 2 git spawns for a branch with no upstream (was up to 3)', async () => {
      ops.resetSpawnCount()
      await ops.status(repo)
      expect(ops.spawnCount()).toBe(2)
    })

    it('costs 2 git spawns for a branch with an upstream (was 4)', async () => {
      const remote = mkdtempSync(join(tmpdir(), 'apiary-branchops-remote-spawn-'))
      git(remote, 'init', '-q', '--bare', '-b', 'main')
      git(repo, 'remote', 'add', 'origin', remote)
      git(repo, 'push', '-q', '-u', 'origin', 'main')
      ops.resetSpawnCount()
      const s = await requireStatus(repo)
      expect(s.hasUpstream).toBe(true)
      expect(ops.spawnCount()).toBe(2)
      rmSync(remote, { recursive: true, force: true })
    })

    it('costs 2 git spawns for a detached HEAD (was 2, but always via the abbrev-ref path)', async () => {
      const sha = git(repo, 'rev-parse', 'HEAD').trim()
      git(repo, 'checkout', '-q', '--detach', sha)
      ops.resetSpawnCount()
      await ops.status(repo)
      expect(ops.spawnCount()).toBe(2)
    })
  })
})

describe('listRefs', () => {
  it('lists local branches, remote branches, and tags with metadata', async () => {
    git(repo, 'branch', 'feature/x')
    git(repo, 'tag', 'v1.0.0')
    const remote = mkdtempSync(join(tmpdir(), 'apiary-branchops-remote2-'))
    git(remote, 'init', '-q', '--bare', '-b', 'main')
    git(repo, 'remote', 'add', 'origin', remote)
    git(repo, 'push', '-q', 'origin', 'main')

    const refs = await ops.listRefs(repo)
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

/** A clone whose `origin/HEAD` exists, the state git >= 2.48 creates itself (`followRemoteHEAD`) and
 *  every older git creates on `clone`. `git for-each-ref --format=%(refname:short)` prints that
 *  symbolic ref as a bare `origin`, which is what the branch lists used to offer as a branch. */
function repoWithOriginHead(): { remote: string; cleanup: () => void } {
  const remote = mkdtempSync(join(tmpdir(), 'apiary-branchops-remote-head-'))
  git(remote, 'init', '-q', '--bare', '-b', 'main')
  git(repo, 'remote', 'add', 'origin', remote)
  git(repo, 'branch', 'feature/x')
  git(repo, 'push', '-q', 'origin', 'main', 'feature/x')
  git(repo, 'fetch', '-q')
  git(repo, 'remote', 'set-head', 'origin', 'main')
  expect(git(repo, 'symbolic-ref', 'refs/remotes/origin/HEAD').trim()).toBe('refs/remotes/origin/main')
  return { remote, cleanup: () => rmSync(remote, { recursive: true, force: true }) }
}

describe('remote branch lists with origin/HEAD set', () => {
  it('listRefs offers the remote branches and not the origin/HEAD alias', async () => {
    const { cleanup } = repoWithOriginHead()
    try {
      const names = (await ops.listRefs(repo)).remote.map((r) => r.name)
      expect(names.sort()).toEqual(['origin/feature/x', 'origin/main'])
    } finally { cleanup() }
  })

  it('listBranchNames (the New worktree dialog) offers the same', async () => {
    const { cleanup } = repoWithOriginHead()
    try {
      const { local, remote } = await ops.listBranchNames(repo)
      expect(remote.sort()).toEqual(['origin/feature/x', 'origin/main'])
      expect(local.sort()).toEqual(['feature/x', 'main'])
    } finally { cleanup() }
  })

  it('names are full refnames minus the namespace, even when a local branch shadows a remote one', async () => {
    const { cleanup } = repoWithOriginHead()
    try {
      // git shortens an ambiguous ref to `heads/origin/main` / `remotes/origin/main`.
      git(repo, 'branch', 'origin/main')
      const refs = await ops.listRefs(repo)
      expect(refs.local.map((r) => r.name).sort()).toEqual(['feature/x', 'main', 'origin/main'])
      expect(refs.remote.map((r) => r.name).sort()).toEqual(['origin/feature/x', 'origin/main'])
      const names = await ops.listBranchNames(repo)
      expect(names.local.sort()).toEqual(['feature/x', 'main', 'origin/main'])
      expect(names.remote.sort()).toEqual(['origin/feature/x', 'origin/main'])
    } finally { cleanup() }
  })
})

describe('checkoutBranch / createBranch', () => {
  it('checks out an existing local branch', async () => {
    git(repo, 'branch', 'feature/x')
    await ops.checkoutBranch(repo, 'feature/x')
    expect((await requireStatus(repo)).branch).toBe('feature/x')
  })

  it('rejects an unknown branch with git\'s own error text', async () => {
    await expect(ops.checkoutBranch(repo, 'nope')).rejects.toThrow(/nope/)
  })

  it('creates a new branch from HEAD', async () => {
    await ops.createBranch(repo, 'feature/new')
    expect((await requireStatus(repo)).branch).toBe('feature/new')
  })

  it('creates a new branch from a given ref', async () => {
    git(repo, 'branch', 'base')
    commit(repo, 'b.txt', 'on main only')
    await ops.createBranch(repo, 'from-base', 'base')
    expect((await requireStatus(repo)).branch).toBe('from-base')
    expect(git(repo, 'log', '--oneline').trim().split('\n')).toHaveLength(1) // only the init commit
  })

  // SEC-9: a name that starts with "-" is not a name `git branch`/`git tag` will *create`, but a
  // remote can still hand back a ref that starts with one, and a checkout of it would be parsed
  // as a flag instead of a ref name.
  it('rejects a ref name that looks like a flag, rather than parsing it as one', async () => {
    await expect(ops.checkoutBranch(repo, '--orphan=x')).rejects.toThrow(/looks like an option/i)
    // No orphan branch was created — the option was never interpreted as one.
    expect((await requireStatus(repo)).branch).toBe('main')
  })

  // git before 2.44 (Ubuntu 24.04 ships 2.43) reads `checkout --end-of-options <ref> --` as two
  // refs and fails every branch switch with "only one reference expected, 2 given". This git is
  // newer and would not show it, so the guard is on what the module passes.
  it('never passes --end-of-options, which older git checkout counts as a ref', () => {
    const source = readFileSync(new URL('../../src/main/git/branchOps.ts', import.meta.url), 'utf8')
    expect(source.match(/'--end-of-options'/g)).toBeNull()
  })

  it('rejects a ref name that is also a real file, rather than falling back to a pathspec checkout', async () => {
    // `git checkout <name>` with no `--` falls back to treating `name` as a pathspec when no such
    // ref exists — which discards local edits to a file of that name. The trailing `--` on
    // checkoutBranch's own args rules that out.
    writeFileSync(join(repo, 'README.md'), 'locally edited, uncommitted')
    await expect(ops.checkoutBranch(repo, 'README.md')).rejects.toThrow()
    expect(readFileSync(join(repo, 'README.md'), 'utf8')).toBe('locally edited, uncommitted')
  })
})

describe('checkoutRemote / checkoutDetached', () => {
  it('creates a local tracking branch from a remote ref', async () => {
    const remote = mkdtempSync(join(tmpdir(), 'apiary-branchops-remote3-'))
    git(remote, 'init', '-q', '--bare', '-b', 'main')
    git(repo, 'remote', 'add', 'origin', remote)
    git(repo, 'push', '-q', 'origin', 'main')
    git(repo, 'checkout', '-q', '-b', 'throwaway')
    git(repo, 'fetch', '-q')

    await ops.checkoutRemote(repo, 'origin/main', 'main-local')
    expect((await requireStatus(repo)).branch).toBe('main-local')
    expect((await requireStatus(repo)).hasUpstream).toBe(true)
    rmSync(remote, { recursive: true, force: true })
  })

  it('checks out a tag detached', async () => {
    git(repo, 'tag', 'v1.0.0')
    await ops.checkoutDetached(repo, 'v1.0.0')
    expect((await requireStatus(repo)).branch).toBeNull()
  })
})

describe('pull / push', () => {
  it('pulls new commits from the upstream', async () => {
    const remote = mkdtempSync(join(tmpdir(), 'apiary-branchops-remote4-'))
    git(remote, 'init', '-q', '--bare', '-b', 'main')
    git(repo, 'remote', 'add', 'origin', remote)
    git(repo, 'push', '-q', '-u', 'origin', 'main')

    const clone = mkdtempSync(join(tmpdir(), 'apiary-branchops-clone-'))
    git(tmpdir(), 'clone', '-q', remote, clone)
    setIdentity(clone, 'test@example.com', 'Test')
    commit(clone, 'from-clone.txt', 'pushed from clone')
    commit(clone, 'from-clone-2.txt', 'second from clone')
    git(clone, 'push', '-q')

    // The count is what the notification shows; a second pull has nothing to bring.
    expect(await ops.pull(repo)).toEqual({ commits: 2 })
    expect(git(repo, 'log', '--oneline')).toContain('pushed from clone')
    expect(await ops.pull(repo)).toEqual({ commits: 0 })
    rmSync(remote, { recursive: true, force: true })
    rmSync(clone, { recursive: true, force: true })
  })

  it('pushes and auto-sets upstream when none exists yet', async () => {
    const remote = mkdtempSync(join(tmpdir(), 'apiary-branchops-remote5-'))
    git(remote, 'init', '-q', '--bare', '-b', 'main')
    git(repo, 'remote', 'add', 'origin', remote)

    commit(repo, 'second.txt', 'second')
    // Publishing: both commits are new to every remote.
    expect(await ops.push(repo)).toEqual({ commits: 2, published: true })
    expect((await requireStatus(repo)).hasUpstream).toBe(true)

    commit(repo, 'third.txt', 'third')
    expect(await ops.push(repo)).toEqual({ commits: 1, published: false })
    expect(await ops.push(repo)).toEqual({ commits: 0, published: false })
    rmSync(remote, { recursive: true, force: true })
  })

  it('rejects push with git\'s own error text when there is no remote at all', async () => {
    await expect(ops.push(repo)).rejects.toThrow(/does not appear to be a git repository|No configured push destination/i)
  })

  it('surfaces the real CONFLICT text (from stdout) on a conflicting pull, not the harmless stderr fetch-progress line', async () => {
    const remote = mkdtempSync(join(tmpdir(), 'apiary-branchops-remote6-'))
    git(remote, 'init', '-q', '--bare', '-b', 'main')
    git(repo, 'remote', 'add', 'origin', remote)
    git(repo, 'push', '-q', '-u', 'origin', 'main')
    // Force an actual merge attempt (not git's "divergent branches, pick a strategy" refusal) so
    // the pull genuinely reaches a real conflict.
    git(repo, 'config', 'pull.rebase', 'false')

    // A second clone of the same remote, diverging from `repo` by editing the same line of the
    // same file — guarantees a real merge conflict (not just a fast-forward) on the eventual pull.
    const other = mkdtempSync(join(tmpdir(), 'apiary-branchops-other-'))
    git(tmpdir(), 'clone', '-q', remote, other)
    setIdentity(other, 'test@example.com', 'Test')
    writeFileSync(join(other, 'README.md'), 'change from other clone')
    git(other, 'add', '.')
    git(other, '-c', 'commit.gpgsign=false', 'commit', '-qm', 'conflicting change from other')
    git(other, 'push', '-q')

    writeFileSync(join(repo, 'README.md'), 'change from repo')
    git(repo, 'add', '.')
    git(repo, '-c', 'commit.gpgsign=false', 'commit', '-qm', 'conflicting change from repo')

    await expect(ops.pull(repo)).rejects.toThrow(/conflict/i)

    rmSync(remote, { recursive: true, force: true })
    rmSync(other, { recursive: true, force: true })
  })
})

describe('merge', () => {
  it('fast-forwards a clean merge from another branch', async () => {
    git(repo, 'branch', 'feature')
    commit(repo, 'feature.txt', 'work on feature')
    const featureSha = git(repo, 'rev-parse', 'HEAD').trim()

    await ops.checkoutBranch(repo, 'main')
    await ops.merge(repo, 'feature')

    // After merging feature into main, main should point to the same commit as feature
    const mainSha = git(repo, 'rev-parse', 'HEAD').trim()
    expect(mainSha).toBe(featureSha)
    expect(git(repo, 'log', '--oneline')).toContain('work on feature')
  })

  it('throws with CONFLICT text on a conflicting merge, and leaves the repo mid-merge', async () => {
    const remote = mkdtempSync(join(tmpdir(), 'apiary-branchops-merge-remote-'))
    git(remote, 'init', '-q', '--bare', '-b', 'main')
    git(repo, 'remote', 'add', 'origin', remote)
    git(repo, 'push', '-q', '-u', 'origin', 'main')

    // Create a conflicting branch in another clone
    const other = mkdtempSync(join(tmpdir(), 'apiary-branchops-merge-other-'))
    git(tmpdir(), 'clone', '-q', remote, other)
    setIdentity(other, 'test@example.com', 'Test')
    writeFileSync(join(other, 'README.md'), 'change from other')
    git(other, 'add', '.')
    git(other, '-c', 'commit.gpgsign=false', 'commit', '-qm', 'conflicting commit from other')
    git(other, 'push', '-q')

    // Create a conflicting change in repo
    git(repo, 'fetch', '-q')
    git(repo, 'branch', 'feature')
    await ops.checkoutBranch(repo, 'feature')
    writeFileSync(join(repo, 'README.md'), 'change from feature')
    git(repo, 'add', '.')
    git(repo, '-c', 'commit.gpgsign=false', 'commit', '-qm', 'conflicting commit from feature')

    // Try to merge the remote change — should fail with CONFLICT in the error
    await expect(ops.merge(repo, 'origin/main')).rejects.toThrow(/conflict/i)

    // Verify the repo is left mid-merge (MERGE_HEAD exists), not auto-aborted. `git` throws on a
    // non-zero exit, so a missing MERGE_HEAD fails the test on its own with git's own message.
    const mergeHead = git(repo, 'rev-parse', 'MERGE_HEAD')
    expect(mergeHead).toMatch(/^[0-9a-f]+/)

    rmSync(remote, { recursive: true, force: true })
    rmSync(other, { recursive: true, force: true })
  })
})

describe('pullFastForward', () => {
  // The pull button on a folder's hover card: one click, for a worktree nobody may be looking at.
  // The guarantees that make that safe are the ones asserted here — it moves the branch only by
  // fast-forwarding, and when it cannot, it changes nothing at all.
  let remote: string
  let other: string

  /** `repo` tracking a bare remote, plus a second clone that stands in for a teammate pushing. */
  beforeEach(() => {
    remote = realpathSync(mkdtempSync(join(tmpdir(), 'apiary-ff-remote-')))
    git(remote, 'init', '-q', '--bare', '-b', 'main')
    git(repo, 'remote', 'add', 'origin', remote)
    git(repo, 'push', '-q', '-u', 'origin', 'main')
    other = realpathSync(mkdtempSync(join(tmpdir(), 'apiary-ff-other-')))
    git(other, 'clone', '-q', remote, '.')
    setIdentity(other, 'other@example.com', 'Other')
  })
  afterEach(() => {
    rmSync(remote, { recursive: true, force: true })
    rmSync(other, { recursive: true, force: true })
  })

  it('brings the branch up to date and says how many commits arrived', async () => {
    commit(other, 'one.txt', 'first upstream commit')
    commit(other, 'two.txt', 'second upstream commit')
    git(other, 'push', '-q')

    expect(await ops.pullFastForward(repo)).toEqual({ commits: 2 })
    expect(git(repo, 'log', '-1', '--format=%s').trim()).toBe('second upstream commit')
  })

  it('reports zero, rather than a success that did nothing, when already up to date', async () => {
    expect(await ops.pullFastForward(repo)).toEqual({ commits: 0 })
  })

  it('refuses a branch that has diverged, and leaves it exactly where it was — no merge commit', async () => {
    commit(other, 'theirs.txt', 'upstream work')
    git(other, 'push', '-q')
    commit(repo, 'mine.txt', 'local work')
    const before = git(repo, 'rev-parse', 'HEAD').trim()

    await expect(ops.pullFastForward(repo)).rejects.toThrow(/fast-forward/i)
    expect(git(repo, 'rev-parse', 'HEAD').trim()).toBe(before)
    expect(git(repo, 'status', '--porcelain').trim()).toBe('')
  })

  it('refuses rather than overwrite an uncommitted change, which it leaves untouched', async () => {
    commit(other, 'README.md', 'upstream edit of the readme')
    git(other, 'push', '-q')
    writeFileSync(join(repo, 'README.md'), 'my unsaved edit')

    await expect(ops.pullFastForward(repo)).rejects.toThrow()
    expect(readFileSync(join(repo, 'README.md'), 'utf8')).toBe('my unsaved edit')
  })
})

describe('fetch', () => {
  it('fetches new commits from a remote and updates remote-tracking refs', async () => {
    const remote = mkdtempSync(join(tmpdir(), 'apiary-branchops-fetch-remote-'))
    git(remote, 'init', '-q', '--bare', '-b', 'main')
    git(repo, 'remote', 'add', 'origin', remote)
    git(repo, 'push', '-q', '-u', 'origin', 'main')

    // Create a new commit in another clone and push it
    const other = mkdtempSync(join(tmpdir(), 'apiary-branchops-fetch-other-'))
    git(tmpdir(), 'clone', '-q', remote, other)
    setIdentity(other, 'test@example.com', 'Test')
    commit(other, 'new-file.txt', 'new commit in other')
    git(other, 'push', '-q')

    // Fetch from the remote in repo — should pick up the new commit
    await ops.fetch(repo)

    // Verify the remote-tracking branch now points to the new commit
    const originMainSha = git(repo, 'rev-parse', 'origin/main').trim()
    const otherHeadSha = git(other, 'rev-parse', 'HEAD').trim()
    expect(originMainSha).toBe(otherHeadSha)
    expect(git(repo, 'log', 'origin/main', '--oneline')).toContain('new commit in other')

    rmSync(remote, { recursive: true, force: true })
    rmSync(other, { recursive: true, force: true })
  })
})

describe('parseWorktreeList', () => {
  const output = [
    'worktree /home/nuwan/projects/paratoo-fdcp',
    'HEAD 1111111111111111111111111111111111111111',
    'branch refs/heads/main',
    '',
    'worktree /home/nuwan/projects/paratoo-fdcp.worktrees/dev-1.0.12',
    'HEAD 2222222222222222222222222222222222222222',
    'branch refs/heads/dev/1.0.12',
    '',
    'worktree /home/nuwan/projects/paratoo-fdcp.worktrees/poking about',
    'HEAD 3333333333333333333333333333333333333333',
    'detached',
    '',
  ].join('\n')

  it('reads every worktree and the branch each has checked out', () => {
    expect(parseWorktreeList(output)).toEqual([
      { path: '/home/nuwan/projects/paratoo-fdcp', branch: 'main' },
      { path: '/home/nuwan/projects/paratoo-fdcp.worktrees/dev-1.0.12', branch: 'dev/1.0.12' },
      { path: '/home/nuwan/projects/paratoo-fdcp.worktrees/poking about', branch: null },
    ])
  })

  it('keeps a branch name that contains a slash intact', () => {
    // The blocking branch in the report that prompted this is `dev/1.0.12`; splitting the ref on
    // "/" rather than stripping the refs/heads/ prefix would turn it into "1.0.12" and match
    // nothing.
    expect(parseWorktreeList(output)[1].branch).toBe('dev/1.0.12')
  })

  it('keeps a worktree path that contains a space intact', () => {
    expect(parseWorktreeList(output)[2].path).toContain('poking about')
  })

  it('is empty for empty output rather than inventing a worktree', () => {
    expect(parseWorktreeList('')).toEqual([])
  })
})

describe('isWorktreeConflict', () => {
  it('recognises the checkout failure that means "it is open somewhere else"', () => {
    expect(isWorktreeConflict(
      "fatal: 'dev/1.0.12' is already used by worktree at '/home/nuwan/p.worktrees/dev-1.0.12'",
    )).toBe(true)
  })

  it('does not claim every checkout failure is one', () => {
    expect(isWorktreeConflict('error: pathspec \'nope\' did not match any file(s) known to git'))
      .toBe(false)
  })
})

describe('a branch checked out in another worktree', () => {
  /** Adds a worktree holding a new branch, the way a worktree-per-ticket layout does. */
  function addWorktree(branch: string): string {
    const path = realpathSync(mkdtempSync(join(tmpdir(), 'apiary-worktree-')))
    rmSync(path, { recursive: true, force: true })
    git(repo, 'worktree', 'add', '-q', '-b', branch, path)
    return path
  }

  it('is found by branch name, without reading it out of git\'s error message', async () => {
    const path = addWorktree('dev/1.0.12')
    try {
      expect(await ops.worktreeForBranch(repo, 'dev/1.0.12')).toBe(path)
    } finally {
      git(repo, 'worktree', 'remove', '--force', path)
    }
  })

  it('answers null for a branch that is not checked out anywhere else', async () => {
    await ops.createBranch(repo, 'unused', 'main')
    await ops.checkoutBranch(repo, 'main')
    expect(await ops.worktreeForBranch(repo, 'unused')).toBeNull()
  })

  it('reports the real refusal, so the app can tell this case from a typo', async () => {
    const path = addWorktree('dev/1.0.12')
    try {
      const message = await ops.checkoutBranch(repo, 'dev/1.0.12').then(() => '', (e: Error) => e.message)
      expect(message).not.toBe('')
      expect(isWorktreeConflict(message)).toBe(true)
    } finally {
      git(repo, 'worktree', 'remove', '--force', path)
    }
  })

  it('lists the main worktree alongside the added one', async () => {
    const path = addWorktree('dev/1.0.12')
    try {
      const all = await ops.listWorktrees(repo)
      expect(all.map((w) => w.branch).sort()).toEqual(['dev/1.0.12', 'main'])
      expect(all.map((w) => w.path)).toContain(repo)
    } finally {
      git(repo, 'worktree', 'remove', '--force', path)
    }
  })
})

describe('updateBranch — the branch list\'s pull button', () => {
  let remote: string
  let other: string
  beforeEach(() => {
    remote = realpathSync(mkdtempSync(join(tmpdir(), 'apiary-branchops-remote-')))
    git(remote, 'init', '-q', '--bare', '-b', 'main')
    git(repo, 'remote', 'add', 'origin', remote)
    git(repo, 'push', '-q', '-u', 'origin', 'main')
    git(repo, 'checkout', '-q', '-b', 'feature/x')
    git(repo, 'push', '-q', '-u', 'origin', 'feature/x')
    git(repo, 'checkout', '-q', 'main')
    // Someone else pushes two commits to feature/x.
    other = realpathSync(mkdtempSync(join(tmpdir(), 'apiary-branchops-other-')))
    git(other, 'clone', '-q', remote, '.')
    setIdentity(other, 'o@example.com', 'Other')
    git(other, 'checkout', '-q', 'feature/x')
    commit(other, 'b.txt', 'theirs 1')
    commit(other, 'c.txt', 'theirs 2')
    git(other, 'push', '-q', 'origin', 'feature/x')
  })
  afterEach(() => { rmSync(remote, { recursive: true, force: true }); rmSync(other, { recursive: true, force: true }) })

  it('fast-forwards a branch that is not checked out, without touching the working tree', async () => {
    const { commits } = await ops.updateBranch(repo, 'feature/x')
    expect(commits).toBe(2)
    expect(git(repo, 'rev-parse', 'feature/x').trim()).toBe(git(repo, 'rev-parse', 'origin/feature/x').trim())
    expect(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('main')
  })

  it('pulls the current branch with a fast-forward', async () => {
    git(repo, 'checkout', '-q', 'feature/x')
    expect((await ops.updateBranch(repo, 'feature/x')).commits).toBe(2)
    expect((await ops.updateBranch(repo, 'feature/x')).commits).toBe(0)
  })

  it('refuses, changing nothing, when the branch has commits the remote does not', async () => {
    git(repo, 'checkout', '-q', 'feature/x')
    commit(repo, 'mine.txt', 'mine')
    git(repo, 'checkout', '-q', 'main')
    const before = git(repo, 'rev-parse', 'feature/x').trim()
    await expect(ops.updateBranch(repo, 'feature/x')).rejects.toThrow(/can't be fast-forwarded|cannot be fast-forwarded/i)
    expect(git(repo, 'rev-parse', 'feature/x').trim()).toBe(before)
  })

  it('says so when the branch has no upstream', async () => {
    git(repo, 'branch', 'local-only')
    await expect(ops.updateBranch(repo, 'local-only')).rejects.toThrow(/no upstream/i)
  })

  it('pulls a branch checked out in another worktree in that worktree', async () => {
    const wt = join(realpathSync(tmpdir()), `apiary-branchops-wt-${String(Date.now())}`)
    git(repo, 'worktree', 'add', '-q', wt, 'feature/x')
    expect((await ops.updateBranch(repo, 'feature/x')).commits).toBe(2)
    expect(git(wt, 'rev-parse', 'HEAD').trim()).toBe(git(repo, 'rev-parse', 'origin/feature/x').trim())
    git(repo, 'worktree', 'remove', '--force', wt)
  })
})

describe('addWorktree — the New worktree dialog', () => {
  const wtDir = (): string => `${repo}.worktrees`
  afterEach(() => { rmSync(wtDir(), { recursive: true, force: true }) })

  it('checks out an existing local branch in a new folder', async () => {
    git(repo, 'branch', 'feature')
    const target = join(wtDir(), 'feature-wt')
    await ops.addWorktree(repo, target, { kind: 'local', branch: 'feature' }, ['main', 'feature'])
    expect((await requireStatus(target)).branch).toBe('feature')
  })

  it('creates a new branch from a chosen base, or from HEAD', async () => {
    git(repo, 'branch', 'base')
    commit(repo, 'b.txt', 'on main only')
    const fromBase = join(wtDir(), 'from-base')
    await ops.addWorktree(repo, fromBase, { kind: 'new', branch: 'topic', from: 'base' }, ['main', 'base'])
    expect((await requireStatus(fromBase)).branch).toBe('topic')
    expect(git(fromBase, 'log', '--oneline').trim().split('\n')).toHaveLength(1)

    const fromHead = join(wtDir(), 'from-head')
    await ops.addWorktree(repo, fromHead, { kind: 'new', branch: 'topic2' }, ['main', 'base', 'topic'])
    expect(git(fromHead, 'log', '--oneline').trim().split('\n')).toHaveLength(2)
  })

  it('a remote branch gets a local branch tracking it — or reuses the local one of that name', async () => {
    const remote = mkdtempSync(join(tmpdir(), 'apiary-branchops-remote-wt-'))
    try {
      git(remote, 'init', '-q', '--bare', '-b', 'main')
      git(repo, 'remote', 'add', 'origin', remote)
      git(repo, 'checkout', '-q', '-b', 'shared')
      git(repo, 'push', '-q', 'origin', 'shared', 'main')
      git(repo, 'checkout', '-q', 'main')
      git(repo, 'branch', '-D', 'shared')
      git(repo, 'fetch', '-q')
      expect((await ops.listBranchNames(repo)).remote).toEqual(expect.arrayContaining(['origin/shared', 'origin/main']))

      const tracking = join(wtDir(), 'shared')
      await ops.addWorktree(repo, tracking, { kind: 'remote', ref: 'origin/shared' }, ['main'])
      const s = await requireStatus(tracking)
      expect(s.branch).toBe('shared')
      expect(s.hasUpstream).toBe(true)
    } finally {
      rmSync(remote, { recursive: true, force: true })
    }
  })

  it('refuses a ref that looks like an option', async () => {
    await expect(ops.addWorktree(repo, join(wtDir(), 'x'), { kind: 'local', branch: '--orphan=x' }, [])).rejects.toThrow(/looks like an option/)
  })
})
