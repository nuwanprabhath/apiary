import { createExec, type ExecFn } from '../exec/run'
import type { GitStatus, GitRefEntry, GitRefs } from '@shared/types'
import { branchFromRef, listRefsArgs, parseRefRows, type RefNamespace, type RefRow } from './refs'

/** Parses `%(upstream)<TAB>%(upstream:track,nobracket)` — see `status()` below. Empty
 *  `upstream` (no such remote-tracking ref configured) means no upstream at all; a present
 *  upstream with an empty `track` means the branch is even with it. */
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

/** Rejects a user-typed ref name that git could misinterpret as a flag (e.g. "-x"). Names that
 *  come back from `listRefs` are always safe (git produced them itself) — this guards only the
 *  free-typed "create new branch" name. */
function assertSafeRefName(name: string): void {
  if (name.trim() === '' || name.startsWith('-')) {
    throw new Error(`Invalid branch name: "${name}"`)
  }
}

/**
 * Rejects a ref that git could read as a flag. A ref starting with "-", fetched from a hostile
 * remote, is a valid ref even though `git branch`/`git tag` refuse to *create* one that way.
 *
 * Checked here rather than with `--end-of-options`: before git 2.44, `checkout` (which keeps
 * `--` for itself) did not understand `--end-of-options` and counted it as a second ref, so every
 * branch switch failed with "fatal: only one reference expected, 2 given" on Ubuntu 24.04's git
 * 2.43. No ref Apiary offers starts with "-", so refusing those loses nothing.
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
 * Parses `git worktree list --porcelain`.
 *
 * Porcelain rather than the human format, and a parser of its own rather than a regex over
 * git's prose: the message that sends us here — "'dev/1.0.12' is already used by worktree at
 * '/…'" — is English, quoted, and not a stable interface, while the porcelain output is exactly
 * that. A branch name may contain a slash, a worktree path may contain a space, and both are
 * ordinary here.
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

/** Whether a failed checkout failed *because* the branch is checked out in another worktree. */
export function isWorktreeConflict(message: string): boolean {
  return /already used by worktree at/i.test(message)
}

export interface BranchOpsOptions {
  /**
   * Runs `git`. MAIN-23: `createExec` already normalises a failure exactly the way this module's
   * `git()` used to build its own message (stderr first, then stdout, then the raw message), so the
   * swap was behaviour-for-behaviour identical. Injected (the container builds the real one) so a
   * test can pin the error-normalisation contract without a real git repository; the integration
   * tests run it against real git.
   */
  exec: ExecFn
}

/** The 15 s `git` runner a `BranchOps` is built with in the app. */
export function createBranchExec(): ExecFn {
  return createExec({ timeoutMs: 15000, scope: 'git' })
}

/**
 * Every `git` operation on a branch, worktree or remote, run through the injected `exec`. Counts
 * the spawns it makes (`spawnCount`), the "measure before fixing" number for MAIN-9. Failures
 * throw with git's real stderr text — unlike `WorktreeResolver` (which swallows failures to `null`
 * for best-effort project detection), every caller here is a user-initiated action whose failure
 * must reach the UI. One instance, built in the container.
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

  /** Same as `git()`, but resolves to `null` on failure instead of throwing — for probes like
   *  "does an upstream exist" where a non-zero exit is an expected, meaningful outcome. */
  private async tryGit(cwd: string, args: string[]): Promise<string | null> {
    try {
      return await this.git(cwd, args)
    } catch {
      return null
    }
  }

  /**
   * The sidebar's git-status poll (MAIN-9): 4 sequential spawns collapsed to 2 for the common case
   * (a branch, with or without an upstream) and to 2 for the uncommon ones (detached HEAD, not a
   * repository at all) too — previously either case still paid for the upstream lookup regardless.
   *
   * `symbolic-ref` gets the branch in one call, in place of the previous `rev-parse --git-dir`
   * (repo-validity probe) followed by `rev-parse --abbrev-ref HEAD` — and it fails identically for
   * a detached HEAD and for "not a repository at all", so those two only cost a second spawn (the
   * validity check, thrown from as before) instead of every poll paying for it up front. `ahead`/
   * `behind` and the upstream's name come from one `for-each-ref` call instead of a separate
   * `rev-parse @{u}` probe plus a `rev-list --count` — `%(upstream:track)` is a format atom, not
   * prose (CLAUDE.md: git's prose is not an interface; this is not that).
   */
  async status(cwd: string): Promise<GitStatus | null> {
    const branch = await this.currentBranch(cwd)
    if (branch === null) {
      // Verify repo validity only for this less common case. "Not a repository" is an outcome, not
      // an error (MAIN-9): a folder without a `.git` is polled every 5s per pane exactly like any
      // other, and before this it threw every single time, which meant a diagnostic log filled with
      // non-errors and `ipc.ts` logging "handler failed" on a schedule for something that never
      // failed at all. `null` is reserved for exactly that case — anything else `git` says here
      // (a real error: permissions, a corrupt repo) still rejects, same as before.
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
    // The trailing `--` guarantees `name` cannot fall back to being read as a pathspec, which is
    // what "git checkout <name>" does when no such ref exists — and silently discards local edits
    // to a file of that name (SEC-9).
    await this.git(cwd, ['checkout', name, '--'])
  }

  async listWorktrees(cwd: string): Promise<WorktreeEntry[]> {
    return parseWorktreeList(await this.git(cwd, ['worktree', 'list', '--porcelain']))
  }

  /**
   * Where `branch` is checked out, or null when it is not checked out anywhere.
   *
   * This is how the worktree that blocks a checkout is found. It is deliberately *not* read out of
   * git's error message: the renderer never supplies a path (see CLAUDE.md), so the path the app
   * then acts on has to be one the main process derived itself from the repository.
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
   * `git worktree add` for each way the New worktree dialog can pick a branch — the same three the
   * simple-worktrees extension offers. A remote branch reuses a local branch of the same name when
   * one exists (checking out `origin/x` twice as two tracking branches is never what was meant),
   * and otherwise creates a local branch tracking it.
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

  /** Plain `git pull`, reporting how many commits HEAD moved by — git's own output is not shown, so
   *  without a count "pulled" read the same whether ten commits arrived or none did. */
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
   * Brings a worktree's branch up to date with its upstream, but only by fast-forwarding.
   *
   * `--ff-only` rather than the plain `pull()` above, because of where this is offered: a one-click
   * button on a folder's hover card, for a worktree the user is usually *not* looking at. Plain
   * `git pull` does whatever the user's config says — merge or rebase — and either can leave that
   * worktree mid-conflict with nobody at a terminal in it. A fast-forward cannot conflict: it
   * either moves the branch to what the remote has, or refuses and changes nothing, and git's own
   * refusal ("Not possible to fast-forward", "would be overwritten") is what gets shown.
   *
   * Returns how many commits arrived, measured from HEAD before and after, so the caller can say
   * "already up to date" instead of reporting a success that did nothing.
   */
  async pullFastForward(cwd: string): Promise<{ commits: number }> {
    const before = await this.git(cwd, ['rev-parse', 'HEAD'])
    await this.git(cwd, ['pull', '--ff-only'])
    return { commits: await this.commitsBetween(cwd, before) }
  }

  /**
   * Brings any local branch up to date with its upstream — the pull button beside each branch in
   * the branch list — by fast-forwarding only, for the same reason as `pullFastForward`: a click in
   * a list must not be able to start a merge or leave a conflict behind.
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

  /** Plain `git push`; if the branch has no upstream yet, retries once as
   *  `git push -u origin HEAD` instead of requiring a separate "publish branch" step.
   *
   *  The count is measured before pushing: commits ahead of the upstream, or — for a branch being
   *  published — commits no remote has yet. It is what was sent, as far as this clone knows. */
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

  /** Merges a ref (branch, tag or commit) into HEAD with `--no-edit`.
   *
   *  A conflict deliberately leaves the tree mid-merge rather than running `merge --abort`: the
   *  shell sitting directly below this toolbar is where the conflict gets resolved, and rolling the
   *  merge back would throw away the one state from which that is possible. The thrown error
   *  carries git's own "CONFLICT (content): ..." text, which arrives on stdout — see `git()`. */
  async merge(cwd: string, ref: string): Promise<void> {
    assertNotOption(ref)
    await this.git(cwd, ['merge', '--no-edit', ref])
  }

  /** Fetches from all remotes and prunes stale remote-tracking refs. */
  async fetch(cwd: string): Promise<void> {
    await this.git(cwd, ['fetch', '--prune'])
  }
}
