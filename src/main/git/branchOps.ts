import { createExec, type ExecFn } from '../exec/run'
import type { GitStatus, GitRefEntry, GitRefs } from '@shared/types'
import { branchFromRef, listRefsArgs, parseRefRows, type RefNamespace, type RefRow } from './refs'

/** Parses `%(upstream)<TAB>%(upstream:track,nobracket)`. An empty upstream means none; an empty `track` means even with it. */
function parseUpstreamTrack(raw: string): { hasUpstream: boolean; ahead: number; behind: number } {
  const [upstream = '', track = ''] = raw.split('\t')
  if (upstream === '') return { hasUpstream: false, ahead: 0, behind: 0 }
  const aheadMatch = /ahead (\d+)/.exec(track)
  const behindMatch = /behind (\d+)/.exec(track)
  return {
    hasUpstream: true,
    ahead: aheadMatch ? Number(aheadMatch[1]) : 0,
    behind: behindMatch ? Number(behindMatch[1]) : 0,
  }
}

const REF_FIELDS = ['%(committerdate:relative)', '%(authorname)', '%(objectname:short)', '%(subject)'] as const

function toEntry({ name, fields }: RefRow): GitRefEntry {
  const [relativeDate = '', author = '', shortSha = '', ...subject] = fields
  return { name, relativeDate, author, shortSha, subject: subject.join('\t') }
}

/** Rejects a free-typed branch name that git could read as a flag; names from `listRefs` are git's own. */
function assertSafeRefName(name: string): void {
  if (name.trim() === '' || name.startsWith('-')) {
    throw new Error(`Invalid branch name: "${name}"`)
  }
}

/**
 * Rejects a ref that git could read as a flag. A ref starting with "-", fetched from a hostile
 * remote, is valid even though `git branch`/`git tag` refuse to create one.
 *
 * Not `--end-of-options`: before git 2.44, `checkout` (which keeps `--` for itself) counted it as
 * a second ref and failed with "only one reference expected, 2 given" on Ubuntu 24.04's git 2.43.
 */
function assertNotOption(ref: string): void {
  if (ref.startsWith('-')) throw new Error(`Refusing a ref that looks like an option: "${ref}"`)
}

/** One entry of `git worktree list --porcelain`. `branch` is null for a detached worktree. */
export interface WorktreeEntry {
  path: string
  branch: string | null
}

/**
 * Parses `git worktree list --porcelain`, not the error prose ("'dev/1.0.12' is already used by
 * worktree at '/…'"), which is not a stable interface. A branch name may contain a slash and a
 * path a space.
 *
 * Records are blank-line separated; each starts with `worktree <path>` and carries either
 * `branch refs/heads/<name>` or a bare `detached`.
 */
export function parseWorktreeList(stdout: string): WorktreeEntry[] {
  const out: WorktreeEntry[] = []
  let path: string | null = null
  let branch: string | null = null
  const flush = (): void => {
    if (path !== null) out.push({ path, branch })
    path = null
    branch = null
  }
  for (const line of stdout.split('\n')) {
    const text = line.trimEnd()
    if (text === '') { flush(); continue }
    if (text.startsWith('worktree ')) { flush(); path = text.slice('worktree '.length); continue }
    if (text.startsWith('branch ')) {
      const ref = text.slice('branch '.length)
      branch = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref
    }
  }
  flush()
  return out
}

export function isWorktreeConflict(message: string): boolean {
  return /already used by worktree at/i.test(message)
}

export interface BranchOpsOptions {
  /** Runs `git`. `createExec` normalises a failure to stderr, then stdout, then the raw message. */
  exec: ExecFn
}

export function createBranchExec(): ExecFn {
  return createExec({ timeoutMs: 15000, scope: 'git' })
}

/**
 * Every `git` operation on a branch, worktree or remote. Failures throw with git's real stderr,
 * unlike `WorktreeResolver` (best-effort, swallows to `null`): every caller here is a user action
 * whose failure must reach the UI.
 */
export class BranchOps {
  private spawns = 0

  constructor(private readonly options: BranchOpsOptions) {}

  spawnCount(): number { return this.spawns }
  resetSpawnCount(): void { this.spawns = 0 }

  private async git(cwd: string, args: string[]): Promise<string> {
    this.spawns += 1
    const stdout = await this.options.exec('git', args, cwd)
    return stdout.trim()
  }

  /** `git()` resolving to `null` on failure, for probes where a non-zero exit is an answer. */
  private async tryGit(cwd: string, args: string[]): Promise<string | null> {
    try {
      return await this.git(cwd, args)
    } catch {
      return null
    }
  }

  /**
   * The sidebar's git-status poll: 2 spawns for a branch, with or without an upstream.
   *
   * `symbolic-ref` fails identically for a detached HEAD and for "not a repository", so only
   * those pay a second spawn (the validity check). `ahead`/`behind` and the upstream's name come
   * from one `for-each-ref`; `%(upstream:track)` is a format atom, not prose.
   */
  async status(cwd: string): Promise<GitStatus | null> {
    const branch = await this.currentBranch(cwd)
    if (branch === null) {
      // "Not a repository" is an outcome, not an error: a folder without `.git` is polled every 5s,
      // and throwing would fill the log. Anything else (permissions, a corrupt repo) still rejects.
      try {
        await this.git(cwd, ['rev-parse', '--git-dir'])
      } catch (e) {
        if (e instanceof Error && /not a git repository/i.test(e.message)) return null
        throw e
      }
      return { branch: null, ahead: 0, behind: 0, hasUpstream: false }
    }

    const raw = await this.tryGit(cwd, [
      'for-each-ref', '--format=%(upstream)\t%(upstream:track,nobracket)', `refs/heads/${branch}`,
    ])
    const { hasUpstream, ahead, behind } = parseUpstreamTrack(raw ?? '')
    return { branch, ahead, behind, hasUpstream }
  }

  /** The checked-out branch, or null when HEAD is detached. Also answers on an unborn branch. */
  private async currentBranch(cwd: string): Promise<string | null> {
    const ref = await this.tryGit(cwd, ['symbolic-ref', '-q', 'HEAD'])
    return ref === null ? null : branchFromRef(ref)
  }

  /** Every ref of one kind, newest first. Symbolic aliases such as `origin/HEAD` are not in it. */
  private async refRows(cwd: string, namespace: RefNamespace, fields: readonly string[] = []): Promise<RefRow[]> {
    return parseRefRows(namespace, await this.git(cwd, listRefsArgs(namespace, fields, '-committerdate')))
  }

  async listRefs(cwd: string): Promise<GitRefs> {
    const [current, local, remote, tags] = await Promise.all([
      this.currentBranch(cwd),
      this.refRows(cwd, 'heads', REF_FIELDS),
      this.refRows(cwd, 'remotes', REF_FIELDS),
      this.refRows(cwd, 'tags', REF_FIELDS),
    ])
    return { current, local: local.map(toEntry), remote: remote.map(toEntry), tags: tags.map(toEntry) }
  }

  async checkoutBranch(cwd: string, name: string): Promise<void> {
    assertNotOption(name)
    // Without `--`, a missing ref makes git read `name` as a pathspec and discard local edits to that file.
    await this.git(cwd, ['checkout', name, '--'])
  }

  async listWorktrees(cwd: string): Promise<WorktreeEntry[]> {
    return parseWorktreeList(await this.git(cwd, ['worktree', 'list', '--porcelain']))
  }

  /**
   * Where `branch` is checked out, or null. Finds the worktree that blocks a checkout, derived
   * from the repository rather than git's error message: the app acts on this path.
   */
  async worktreeForBranch(cwd: string, branch: string): Promise<string | null> {
    const found = (await this.listWorktrees(cwd)).find((w) => w.branch === branch)
    return found?.path ?? null
  }

  async checkoutRemote(cwd: string, remoteRef: string, localName: string): Promise<void> {
    assertSafeRefName(localName)
    assertNotOption(remoteRef)
    await this.git(cwd, ['checkout', '-b', localName, '--track', remoteRef, '--'])
  }

  async checkoutDetached(cwd: string, ref: string): Promise<void> {
    assertNotOption(ref)
    await this.git(cwd, ['checkout', '--detach', ref, '--'])
  }

  async createBranch(cwd: string, name: string, from?: string): Promise<void> {
    assertSafeRefName(name)
    if (from !== undefined) assertSafeRefName(from)
    await this.git(cwd, from ? ['checkout', '-b', name, from, '--'] : ['checkout', '-b', name])
  }

  /** Local and remote-tracking branch names, newest first, without `origin/HEAD`-style aliases. */
  async listBranchNames(cwd: string): Promise<{ local: string[]; remote: string[] }> {
    const [local, remote] = await Promise.all([this.refRows(cwd, 'heads'), this.refRows(cwd, 'remotes')])
    return { local: local.map((r) => r.name), remote: remote.map((r) => r.name) }
  }

  /**
   * `git worktree add` for each way the New worktree dialog picks a branch. A remote branch reuses
   * a local branch of the same name when one exists, otherwise creates one tracking it.
   */
  async addWorktree(
    cwd: string,
    target: string,
    choice: { kind: 'local'; branch: string } | { kind: 'remote'; ref: string } | { kind: 'new'; branch: string; from?: string },
    localBranches: readonly string[],
  ): Promise<void> {
    if (choice.kind === 'local') {
      assertNotOption(choice.branch)
      await this.git(cwd, ['worktree', 'add', target, choice.branch])
    } else if (choice.kind === 'remote') {
      assertNotOption(choice.ref)
      const localName = choice.ref.split('/').slice(1).join('/')
      if (localName !== '' && localBranches.includes(localName)) {
        await this.git(cwd, ['worktree', 'add', target, localName])
      } else {
        assertSafeRefName(localName)
        await this.git(cwd, ['worktree', 'add', '--track', '-b', localName, target, choice.ref])
      }
    } else {
      assertSafeRefName(choice.branch)
      if (choice.from !== undefined) assertNotOption(choice.from)
      await this.git(cwd, ['worktree', 'add', '-b', choice.branch, target, ...(choice.from !== undefined ? [choice.from] : [])])
    }
  }

  /** Plain `git pull`, reporting how many commits HEAD moved by (git's output is not shown). */
  async pull(cwd: string): Promise<{ commits: number }> {
    const before = await this.git(cwd, ['rev-parse', 'HEAD'])
    await this.git(cwd, ['pull'])
    return { commits: await this.commitsBetween(cwd, before) }
  }

  /** Commits reachable from HEAD but not from `before` — 0 when HEAD did not move. */
  private async commitsBetween(cwd: string, before: string): Promise<number> {
    const after = await this.git(cwd, ['rev-parse', 'HEAD'])
    if (before === after) return 0
    return Number(await this.git(cwd, ['rev-list', '--count', `${before}..${after}`]))
  }

  /**
   * Fast-forward-only pull of a worktree's branch. Offered as a one-click button for a worktree
   * the user is not looking at, where the configured merge or rebase of plain `pull()` could leave
   * it mid-conflict with nobody at a terminal. A fast-forward moves the branch or refuses and
   * changes nothing; git's refusal is what gets shown. Returns how many commits arrived.
   */
  async pullFastForward(cwd: string): Promise<{ commits: number }> {
    const before = await this.git(cwd, ['rev-parse', 'HEAD'])
    await this.git(cwd, ['pull', '--ff-only'])
    return { commits: await this.commitsBetween(cwd, before) }
  }

  /**
   * Fast-forward-only update of any local branch (the pull button in the branch list), for the
   * reason `pullFastForward` gives.
   *
   * - The branch checked out here: `git pull --ff-only`.
   * - Checked out in another worktree: the same, run in that worktree (git will not move a branch
   *   another worktree has checked out from here).
   * - Not checked out anywhere: `git fetch <remote> <upstream>:<branch>`, which moves the branch
   *   without touching any working tree, and refuses anything but a fast-forward.
   */
  async updateBranch(cwd: string, branch: string): Promise<{ commits: number }> {
    const current = await this.currentBranch(cwd)
    if (current === branch) return this.pullFastForward(cwd)
    const elsewhere = await this.worktreeForBranch(cwd, branch)
    if (elsewhere !== null) return this.pullFastForward(elsewhere)

    const remote = await this.tryGit(cwd, ['config', `branch.${branch}.remote`])
    const merge = await this.tryGit(cwd, ['config', `branch.${branch}.merge`])
    if (remote === null || merge === null || remote === '' || merge === '') {
      throw new Error(`${branch} has no upstream branch to pull from.`)
    }
    const before = await this.git(cwd, ['rev-parse', `refs/heads/${branch}`])
    try {
      await this.git(cwd, ['fetch', remote, `${merge}:refs/heads/${branch}`])
    } catch (e) {
      if (e instanceof Error && /non-fast-forward|rejected/i.test(e.message)) {
        throw new Error(`${branch} has commits the remote does not, so it can't be fast-forwarded. Check it out and pull to merge them.`, { cause: e })
      }
      throw e
    }
    const after = await this.git(cwd, ['rev-parse', `refs/heads/${branch}`])
    if (before === after) return { commits: 0 }
    return { commits: Number(await this.git(cwd, ['rev-list', '--count', `${before}..${after}`])) }
  }

  /** Plain `git push`; with no upstream yet, retries once as `git push -u origin HEAD`.
   *  The count is measured before pushing: commits ahead of the upstream, or for a published
   *  branch, commits no remote has. */
  async push(cwd: string): Promise<{ commits: number; published: boolean }> {
    const ahead = await this.tryGit(cwd, ['rev-list', '--count', '@{upstream}..HEAD'])
    try {
      await this.git(cwd, ['push'])
      return { commits: Number(ahead ?? 0), published: false }
    } catch (e) {
      if (e instanceof Error && /has no upstream branch/i.test(e.message)) {
        const unpushed = await this.tryGit(cwd, ['rev-list', '--count', 'HEAD', '--not', '--remotes'])
        await this.git(cwd, ['push', '-u', 'origin', 'HEAD'])
        return { commits: Number(unpushed ?? 0), published: true }
      }
      throw e
    }
  }

  /** Merges a ref into HEAD with `--no-edit`. A conflict deliberately leaves the tree mid-merge:
   *  the shell below the toolbar is where it gets resolved. The thrown error carries git's
   *  "CONFLICT (content): ..." text, which arrives on stdout. */
  async merge(cwd: string, ref: string): Promise<void> {
    assertNotOption(ref)
    await this.git(cwd, ['merge', '--no-edit', ref])
  }

  async fetch(cwd: string): Promise<void> {
    await this.git(cwd, ['fetch', '--prune'])
  }
}
