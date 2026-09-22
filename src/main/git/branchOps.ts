import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { GitStatus, GitRefEntry, GitRefs } from '@shared/types'

const run = promisify(execFile)

/** Runs git and throws with its real stderr text on failure — unlike worktreeResolver's own
 *  `git()` helper (which swallows failures to `null` for best-effort project detection), every
 *  caller here is a user-initiated action whose failure must reach the UI. */
async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await run('git', args, { cwd, timeout: 15000 })
    return stdout.trim()
  } catch (e) {
    // A conflicting `git pull` (etc.) puts the actual, useful diagnostic — e.g.
    // "CONFLICT (content): Merge conflict in f.txt" — on STDOUT, while STDERR often only carries
    // a harmless fetch-progress line ("From ... main -> origin/main") that reads like success.
    // Surface both, stderr first (push()'s `/has no upstream branch/i` check matches stderr text,
    // so it must stay first), and fall back to `message` only when both streams are empty (e.g.
    // an execFile timeout kill leaves stdout/stderr blank).
    const err = e as { stdout?: string; stderr?: string; message: string }
    const text = [err.stderr, err.stdout].filter(Boolean).join('\n').trim()
    throw new Error(text !== '' ? text : err.message)
  }
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

export async function status(cwd: string): Promise<GitStatus> {
  // Verify repo validity up front — throws on non-repo so callers can surface the error to the UI
  await git(cwd, ['rev-parse', '--git-dir'])

  const rawBranch = await tryGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const branch = rawBranch === null || rawBranch === 'HEAD' ? null : rawBranch

  const upstream = await tryGit(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
  if (upstream === null) return { branch, ahead: 0, behind: 0, hasUpstream: false }

  const counts = await git(cwd, ['rev-list', '--left-right', '--count', 'HEAD...@{u}'])
  const [ahead, behind] = counts.split(/\s+/).map(Number)
  return { branch, ahead, behind, hasUpstream: true }
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
  await git(cwd, ['checkout', name])
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
  await git(cwd, ['checkout', '-b', localName, '--track', remoteRef])
}

export async function checkoutDetached(cwd: string, ref: string): Promise<void> {
  await git(cwd, ['checkout', '--detach', ref])
}

export async function createBranch(cwd: string, name: string, from?: string): Promise<void> {
  assertSafeRefName(name)
  await git(cwd, from ? ['checkout', '-b', name, from] : ['checkout', '-b', name])
}

export async function pull(cwd: string): Promise<void> {
  await git(cwd, ['pull'])
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
  const after = await git(cwd, ['rev-parse', 'HEAD'])
  if (before === after) return { commits: 0 }
  return { commits: Number(await git(cwd, ['rev-list', '--count', `${before}..${after}`])) }
}

/** Plain `git push`; if the branch has no upstream yet, retries once as
 *  `git push -u origin HEAD` instead of requiring a separate "publish branch" step. */
export async function push(cwd: string): Promise<void> {
  try {
    await git(cwd, ['push'])
  } catch (e) {
    if (e instanceof Error && /has no upstream branch/i.test(e.message)) {
      await git(cwd, ['push', '-u', 'origin', 'HEAD'])
      return
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
  await git(cwd, ['merge', '--no-edit', ref])
}

/** Fetches from all remotes and prunes stale remote-tracking refs. */
export async function fetch(cwd: string): Promise<void> {
  await git(cwd, ['fetch', '--prune'])
}
