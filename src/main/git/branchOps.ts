import { createExec, type ExecFn } from '../exec/run'
import type { GitStatus, GitRefEntry, GitRefs } from '@shared/types'

/**
 * MAIN-23: `createExec` already normalises a failure exactly the way this module's `git()` used
 * to build its own message (stderr first, then stdout, then the raw message) — this was the
 * wrapper that pattern was extracted from, so the swap is behaviour-for-behaviour identical.
 * Injectable so `tests/unit/branchOpsExec.test.ts` can pin the error-normalisation contract
 * without a real git repository; every other test in `tests/integration/branchOps.test.ts` still
 * runs against real git and is unchanged.
 */
let execGit: ExecFn = createExec({ timeoutMs: 15000, scope: 'git' })
export function setExecForTesting(fn: ExecFn | null): void {
  execGit = fn ?? createExec({ timeoutMs: 15000, scope: 'git' })
}

/** Counts actual `git` spawns since the last reset — the "measure before fixing" number for
 *  MAIN-9, mirroring `worktreeResolver.ts`'s `resolverSpawnCount`. */
let spawnCount = 0
export function branchOpsSpawnCount(): number { return spawnCount }
export function resetBranchOpsSpawnCount(): void { spawnCount = 0 }

/** Runs git and throws with its real stderr text on failure — unlike worktreeResolver's own
 *  `git()` helper (which swallows failures to `null` for best-effort project detection), every
 *  caller here is a user-initiated action whose failure must reach the UI. */
async function git(cwd: string, args: string[]): Promise<string> {
  spawnCount += 1
  const stdout = await execGit('git', args, cwd)
  return stdout.trim()
}

/** Same as `git()`, but resolves to `null` on failure instead of throwing — for probes like
 *  "does an upstream exist" where a non-zero exit is an expected, meaningful outcome. */
async function tryGit(cwd: string, args: string[]): Promise<string | null> {
  try {
    return await git(cwd, args)
  } catch {
    return null
  }
}

/** Parses `%(upstream:short)<TAB>%(upstream:track,nobracket)` — see `status()` below. Empty
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
export async function status(cwd: string): Promise<GitStatus | null> {
  const branch = await tryGit(cwd, ['symbolic-ref', '-q', '--short', 'HEAD'])
  if (branch === null) {
    // Verify repo validity only for this less common case. "Not a repository" is an outcome, not
    // an error (MAIN-9): a folder without a `.git` is polled every 5s per pane exactly like any
    // other, and before this it threw every single time, which meant a diagnostic log filled with
    // non-errors and `ipc.ts` logging "handler failed" on a schedule for something that never
    // failed at all. `null` is reserved for exactly that case — anything else `git` says here
    // (a real error: permissions, a corrupt repo) still rejects, same as before.
    try {
      await git(cwd, ['rev-parse', '--git-dir'])
    } catch (e) {
      if (e instanceof Error && /not a git repository/i.test(e.message)) return null
      throw e
    }
    return { branch: null, ahead: 0, behind: 0, hasUpstream: false }
  }

  const raw = await tryGit(cwd, [
    'for-each-ref', '--format=%(upstream:short)\t%(upstream:track,nobracket)', `refs/heads/${branch}`,
  ])
  const { hasUpstream, ahead, behind } = parseUpstreamTrack(raw ?? '')
  return { branch, ahead, behind, hasUpstream }
}

const REF_FORMAT = '%(refname:short)%09%(committerdate:relative)%09%(authorname)%09%(objectname:short)%09%(subject)'

function parseRefs(raw: string): GitRefEntry[] {
  if (raw === '') return []
  return raw.split('\n').map((line) => {
    const [name, relativeDate, author, shortSha, subject] = line.split('\t')
    return { name, relativeDate, author, shortSha, subject }
  })
}

export async function listRefs(cwd: string): Promise<GitRefs> {
  const rawCurrent = await tryGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const current = rawCurrent === null || rawCurrent === 'HEAD' ? null : rawCurrent

  const [localRaw, remoteRaw, tagRaw] = await Promise.all([
    git(cwd, ['for-each-ref', '--sort=-committerdate', `--format=${REF_FORMAT}`, 'refs/heads/']),
    git(cwd, ['for-each-ref', '--sort=-committerdate', `--format=${REF_FORMAT}`, 'refs/remotes/']),
    git(cwd, ['for-each-ref', '--sort=-committerdate', `--format=${REF_FORMAT}`, 'refs/tags/']),
  ])

  return {
    current,
    local: parseRefs(localRaw),
    // origin/HEAD is a symbolic ref to another remote branch, not a real branch to switch to.
    remote: parseRefs(remoteRaw).filter((r) => !r.name.endsWith('/HEAD')),
    tags: parseRefs(tagRaw),
  }
}

/** Rejects a user-typed ref name that git could misinterpret as a flag (e.g. "-x"). Names that
 *  come back from `listRefs` are always safe (git produced them itself) — this guards only the
 *  free-typed "create new branch" name. */
function assertSafeRefName(name: string): void {
  if (name.trim() === '' || name.startsWith('-')) {
    throw new Error(`Invalid branch name: "${name}"`)
  }
}

export async function checkoutBranch(cwd: string, name: string): Promise<void> {
  // `--end-of-options` guarantees `name` cannot be parsed as a flag (a ref that starts with "-",
  // fetched from a hostile remote, is a valid ref even though `git branch`/`git tag` refuse to
  // *create* one that way); the trailing `--` guarantees it cannot fall back to being read as a
  // pathspec either, which is what "git checkout <name>" does when no such ref exists — and
  // silently discards local edits to a file of that name (SEC-9).
  await git(cwd, ['checkout', '--end-of-options', name, '--'])
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

export async function listWorktrees(cwd: string): Promise<WorktreeEntry[]> {
  return parseWorktreeList(await git(cwd, ['worktree', 'list', '--porcelain']))
}

/**
 * Where `branch` is checked out, or null when it is not checked out anywhere.
 *
 * This is how the worktree that blocks a checkout is found. It is deliberately *not* read out of
 * git's error message: the renderer never supplies a path (see CLAUDE.md), so the path the app
 * then acts on has to be one the main process derived itself from the repository.
 */
export async function worktreeForBranch(cwd: string, branch: string): Promise<string | null> {
  const found = (await listWorktrees(cwd)).find((w) => w.branch === branch)
  return found?.path ?? null
}

/** Whether a failed checkout failed *because* the branch is checked out in another worktree. */
export function isWorktreeConflict(message: string): boolean {
  return /already used by worktree at/i.test(message)
}

export async function checkoutRemote(cwd: string, remoteRef: string, localName: string): Promise<void> {
  assertSafeRefName(localName)
  await git(cwd, ['checkout', '-b', localName, '--track', '--end-of-options', remoteRef, '--'])
}

export async function checkoutDetached(cwd: string, ref: string): Promise<void> {
  await git(cwd, ['checkout', '--detach', '--end-of-options', ref, '--'])
}

export async function createBranch(cwd: string, name: string, from?: string): Promise<void> {
  assertSafeRefName(name)
  if (from !== undefined) assertSafeRefName(from)
  await git(cwd, from ? ['checkout', '-b', name, '--end-of-options', from, '--'] : ['checkout', '-b', name])
}

/** Plain `git pull`, reporting how many commits HEAD moved by — git's own output is not shown, so
 *  without a count "pulled" read the same whether ten commits arrived or none did. */
export async function pull(cwd: string): Promise<{ commits: number }> {
  const before = await git(cwd, ['rev-parse', 'HEAD'])
  await git(cwd, ['pull'])
  return { commits: await commitsBetween(cwd, before) }
}

/** Commits reachable from HEAD but not from `before` — 0 when HEAD did not move. */
async function commitsBetween(cwd: string, before: string): Promise<number> {
  const after = await git(cwd, ['rev-parse', 'HEAD'])
  if (before === after) return 0
  return Number(await git(cwd, ['rev-list', '--count', `${before}..${after}`]))
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
export async function pullFastForward(cwd: string): Promise<{ commits: number }> {
  const before = await git(cwd, ['rev-parse', 'HEAD'])
  await git(cwd, ['pull', '--ff-only'])
  return { commits: await commitsBetween(cwd, before) }
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
export async function updateBranch(cwd: string, branch: string): Promise<{ commits: number }> {
  const current = await tryGit(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
  if (current === branch) return pullFastForward(cwd)
  const elsewhere = await worktreeForBranch(cwd, branch)
  if (elsewhere !== null) return pullFastForward(elsewhere)

  const remote = await tryGit(cwd, ['config', `branch.${branch}.remote`])
  const merge = await tryGit(cwd, ['config', `branch.${branch}.merge`])
  if (remote === null || merge === null || remote === '' || merge === '') {
    throw new Error(`${branch} has no upstream branch to pull from.`)
  }
  const before = await git(cwd, ['rev-parse', `refs/heads/${branch}`])
  try {
    await git(cwd, ['fetch', remote, `${merge}:refs/heads/${branch}`])
  } catch (e) {
    if (e instanceof Error && /non-fast-forward|rejected/i.test(e.message)) {
      throw new Error(`${branch} has commits the remote does not, so it can't be fast-forwarded. Check it out and pull to merge them.`, { cause: e })
    }
    throw e
  }
  const after = await git(cwd, ['rev-parse', `refs/heads/${branch}`])
  if (before === after) return { commits: 0 }
  return { commits: Number(await git(cwd, ['rev-list', '--count', `${before}..${after}`])) }
}

/** Plain `git push`; if the branch has no upstream yet, retries once as
 *  `git push -u origin HEAD` instead of requiring a separate "publish branch" step.
 *
 *  The count is measured before pushing: commits ahead of the upstream, or — for a branch being
 *  published — commits no remote has yet. It is what was sent, as far as this clone knows. */
export async function push(cwd: string): Promise<{ commits: number; published: boolean }> {
  const ahead = await tryGit(cwd, ['rev-list', '--count', '@{upstream}..HEAD'])
  try {
    await git(cwd, ['push'])
    return { commits: Number(ahead ?? 0), published: false }
  } catch (e) {
    if (e instanceof Error && /has no upstream branch/i.test(e.message)) {
      const unpushed = await tryGit(cwd, ['rev-list', '--count', 'HEAD', '--not', '--remotes'])
      await git(cwd, ['push', '-u', 'origin', 'HEAD'])
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
export async function merge(cwd: string, ref: string): Promise<void> {
  await git(cwd, ['merge', '--no-edit', '--end-of-options', ref])
}

/** Fetches from all remotes and prunes stale remote-tracking refs. */
export async function fetch(cwd: string): Promise<void> {
  await git(cwd, ['fetch', '--prune'])
}
