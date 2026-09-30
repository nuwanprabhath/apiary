/** Git-domain types shared by main (which computes them) and the renderer (which shows them). */

export interface GitStatus {
  branch: string | null
  ahead: number
  behind: number
  hasUpstream: boolean
}

/** One row in the branch switcher's branch/remote/tag lists. */
export interface GitRefEntry {
  name: string
  relativeDate: string
  author: string
  shortSha: string
  subject: string
}

export interface GitRefs {
  current: string | null
  local: GitRefEntry[]
  remote: GitRefEntry[]
  tags: GitRefEntry[]
}

/**
 * A worktree of a sidebar folder's repository, as `git worktree list` reports it — including the
 * ones no Claude session has been started in, which the tree itself never holds. Listed on demand
 * (a folder's "Show all worktrees") so a session can be started there.
 */
export interface FolderWorktree {
  path: string
  /** Null for a detached worktree. */
  branch: string | null
}

/**
 * A checkout refused because the branch is already checked out in another worktree.
 *
 * Reported rather than thrown, because it is not really a failure — the branch *is* available,
 * just somewhere else, and the two things anyone actually wants at that moment (bring it up to
 * date where it lives, or go and work in it) are both doable from here. Being told "fatal: …
 * already used by worktree at …" and left to go and find that directory by hand is the part
 * this replaces.
 */
export interface WorktreeConflict {
  branch: string
  /** Absolute path of the worktree holding it — resolved in the main process, shown for context. */
  worktreePath: string
  /** Its last path segment, which is what the folder is called in the sidebar. */
  label: string
}

/** What a branch checkout did. A worktree conflict is an outcome, not an error. */
export type CheckoutOutcome =
  | { ok: true }
  | { ok: false; conflict: WorktreeConflict }

/** A GitLab merge request's state, as `glab` reports it — see `main/git/mrStatusCache.ts`. */
export type MrState = 'opened' | 'merged' | 'closed' | 'locked'

/**
 * What the "New worktree" dialog needs to know about a repository before asking anything, all
 * derived by main from git itself (the renderer only names the sidebar folder it came from).
 * Worktrees go beside the main checkout as `<main>.worktrees/<name>` — the same layout the
 * simple-worktrees VS Code extension uses, so the two agree on where things are.
 */
export interface WorktreeCreateOptions {
  /** `<main checkout>.worktrees` — where the new folder will be created. */
  parentDir: string
  /** Names already taken in `parentDir`. */
  existingNames: string[]
  local: string[]
  /** `origin/x` style, without the `origin/HEAD` alias. */
  remote: string[]
  /** Local branches checked out in some worktree already; git refuses a second one. */
  checkedOut: string[]
}

export type WorktreeBranchChoice =
  | { kind: 'local'; branch: string }
  | { kind: 'remote'; ref: string }
  /** A brand-new branch, from `from` (a local or remote ref), or from HEAD when absent. */
  | { kind: 'new'; branch: string; from?: string }

export interface WorktreeCreateRequest {
  name: string
  branch: WorktreeBranchChoice
}

/** Why `name` cannot be a new worktree folder, or null when it can. Checked on both sides. */
export function worktreeNameProblem(name: string, existing: readonly string[] = []): string | null {
  const trimmed = name.trim()
  if (trimmed === '') return 'A name is required.'
  if (/[\\/]/.test(trimmed)) return 'The name cannot contain slashes.'
  if (trimmed === '.' || trimmed === '..' || trimmed.startsWith('-')) return 'That is not a usable folder name.'
  if (existing.includes(trimmed)) return 'A folder with this name already exists.'
  return null
}

const isStr = (v: unknown): v is string => typeof v === 'string'

export function isWorktreeCreateRequest(v: unknown): v is WorktreeCreateRequest {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  if (!isStr(r.name) || typeof r.branch !== 'object' || r.branch === null) return false
  const b = r.branch as Record<string, unknown>
  if (b.kind === 'local') return isStr(b.branch)
  if (b.kind === 'remote') return isStr(b.ref)
  if (b.kind === 'new') return isStr(b.branch) && (b.from === undefined || isStr(b.from))
  return false
}
