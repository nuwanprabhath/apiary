import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import * as branchOps from './branchOps'
import { originUrl, defaultExec as defaultGitExec } from '../plugins/gitlabMr'
import { parseGitLabRemote } from '../plugins/gitlabRemote'
import { resolveMrStatus, type MrState } from './mrStatusCache'
import { log } from '../log/logger'
import type { SessionResolver } from '../sessions/sessionResolver'
import type { GitStatus, GitRefs, CheckoutOutcome, FolderWorktree } from '@shared/types'

export interface GitServiceDeps {
  resolver: SessionResolver
  /** Path to the `glab` executable, for anyone whose install is not on PATH (and for tests). */
  glabPath?: string
}

/**
 * Every `git*` operation `AppService` used to implement inline (MAIN-14 step 3): status, refs,
 * checkout/branch/pull/push/merge/fetch, worktree lookups, and the GitLab MR-reference resolver.
 * Every cwd comes from `resolver.resolveShellCwd`/`requireFolder` — this class never receives a
 * raw filesystem path from the renderer. Pure move: behaviour, ordering and error text are
 * unchanged from what `AppService` did; see `tests/unit/gitService.test.ts`.
 *
 * Owns `lastBranch` (moved out of `AppService`, which only ever wrote it from `status()` and read
 * it from `pluginContext()`) — a folder's last-seen branch is git state, so it lives beside the
 * rest of it rather than being a second field on the class that merely calls this one.
 */
export class GitService {
  private readonly resolver: SessionResolver
  private readonly glabPath: string | undefined
  /** Which branch each folder was last seen on, filled in by `status()` — read by `AppService`'s
   *  plugin context so the bar's own git polling is what keeps plugins current, with no second
   *  `git` call of their own. */
  private readonly lastBranch = new Map<string, string | null>()

  constructor(deps: GitServiceDeps) {
    this.resolver = deps.resolver
    this.glabPath = deps.glabPath
  }

  /** The folder's branch as of its last `status()` call, or null if none has been made (or the
   *  folder was not a repository). Used by `AppService.pluginContext`. */
  lastBranchFor(cwd: string): string | null {
    return this.lastBranch.get(cwd) ?? null
  }

  /** Null means `cwd` is not (or is no longer) a git repository — an outcome, not a failure: see
   *  MAIN-9. Anything else `git` gets wrong there still rejects. */
  async status(key: string, isPtyId: boolean): Promise<GitStatus | null> {
    const cwd = this.resolver.resolveShellCwd(key, isPtyId)
    const status = await branchOps.status(cwd)
    this.lastBranch.set(cwd, status?.branch ?? null)
    return status
  }

  async listRefs(key: string, isPtyId: boolean): Promise<GitRefs> {
    return branchOps.listRefs(this.resolver.resolveShellCwd(key, isPtyId))
  }

  /**
   * Resolves each `!<iid>` reference named in a session's title or note against its GitLab
   * remote, the way the session-bar plugin resolves its own button: through `glab`, never a
   * stored token. No remote, no `glab`, a non-zero exit or a timeout all map every iid to `null`
   * rather than throwing — an unresolved reference is meant to render exactly as if this call
   * had never been made.
   */
  async mrRefStatus(
    key: string, isPtyId: boolean, iids: number[],
  ): Promise<Record<number, MrState | null>> {
    const cwd = this.resolver.resolveShellCwd(key, isPtyId)
    const out: Record<number, MrState | null> = {}
    const remoteUrl = await originUrl(cwd, defaultGitExec)
    const remote = remoteUrl === null ? null : parseGitLabRemote(remoteUrl)
    if (remote === null) {
      for (const iid of iids) out[iid] = null
      return out
    }
    await Promise.all(iids.map(async (iid) => {
      out[iid] = await resolveMrStatus(cwd, remote.host, remote.project, iid, { glabPath: this.glabPath })
    }))
    return out
  }

  /**
   * Checks out a branch, reporting the one failure that is not really a failure.
   *
   * Git refuses to check out a branch that another worktree already has, and says so in prose. On
   * a repository with a worktree per ticket that is the *normal* answer, not an error: the branch
   * exists and is up the road in another directory. Returning it as an outcome lets the UI offer
   * the two things wanted at that point — update it where it lives, or open a session there —
   * instead of printing git's sentence and leaving the user to go and find the folder.
   *
   * The worktree's path is looked up with `git worktree list --porcelain` rather than scraped out
   * of the message. The message is English and quoted; the porcelain output is an interface. It
   * also keeps the rule that a path the app later acts on is one the main process derived itself.
   */
  async checkoutBranch(key: string, isPtyId: boolean, name: string): Promise<CheckoutOutcome> {
    const cwd = this.resolver.resolveShellCwd(key, isPtyId)
    try {
      await branchOps.checkoutBranch(cwd, name)
      return { ok: true }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (!branchOps.isWorktreeConflict(message)) throw e
      const worktreePath = await branchOps.worktreeForBranch(cwd, name)
      log.info('git', 'checkout refused: branch is in another worktree', {
        branch: name, cwd, worktreePath,
      })
      // Git said a worktree has it but the list does not agree — rather than invent an answer,
      // let the original error through, which at least says what git said.
      if (worktreePath === null) throw e
      return { ok: false, conflict: { branch: name, worktreePath, label: basename(worktreePath) } }
    }
  }

  /**
   * Resolves the worktree holding `branch`, for the two follow-ups a conflict offers.
   *
   * The renderer names the *branch*, never the path: this is the same trust boundary every other
   * cwd-carrying call goes through, and the answer is re-derived each time because a worktree can
   * be removed between the refusal and the click.
   */
  async requireWorktreeFor(key: string, isPtyId: boolean, branch: string): Promise<string> {
    const cwd = this.resolver.resolveShellCwd(key, isPtyId)
    const path = await branchOps.worktreeForBranch(cwd, branch)
    if (path === null) {
      throw new Error(`${branch} is no longer checked out in a worktree of this repository`)
    }
    if (!existsSync(path)) throw new Error(`That worktree no longer exists: ${path}`)
    return path
  }

  /** Pulls `branch` in the worktree that has it, which is the only place it *can* be pulled. */
  async pullWorktree(
    key: string, isPtyId: boolean, branch: string,
  ): Promise<{ path: string; commits: number }> {
    const path = await this.requireWorktreeFor(key, isPtyId, branch)
    const { commits } = await branchOps.pull(path)
    return { path, commits }
  }

  async checkoutRemote(key: string, isPtyId: boolean, remoteRef: string, localName: string): Promise<void> {
    await branchOps.checkoutRemote(this.resolver.resolveShellCwd(key, isPtyId), remoteRef, localName)
  }

  async checkoutDetached(key: string, isPtyId: boolean, ref: string): Promise<void> {
    await branchOps.checkoutDetached(this.resolver.resolveShellCwd(key, isPtyId), ref)
  }

  async createBranch(key: string, isPtyId: boolean, name: string, from?: string): Promise<void> {
    await branchOps.createBranch(this.resolver.resolveShellCwd(key, isPtyId), name, from)
  }

  async pull(key: string, isPtyId: boolean): Promise<{ commits: number }> {
    return branchOps.pull(this.resolver.resolveShellCwd(key, isPtyId))
  }

  /** Fast-forwards any local branch from its upstream (the branch list's pull button). */
  async updateBranch(key: string, isPtyId: boolean, branch: string): Promise<{ commits: number }> {
    return branchOps.updateBranch(this.resolver.resolveShellCwd(key, isPtyId), branch)
  }

  /**
   * Fast-forwards a folder's branch from its upstream — the pull button on a folder's hover card.
   * `path` comes from the renderer, so it is checked against a stored project row before git
   * runs anywhere, the same rule `newSessionInProject` keeps.
   */
  async pullFolder(path: string): Promise<{ commits: number }> {
    return branchOps.pullFastForward(this.resolver.requireFolder(path))
  }

  /**
   * Every other worktree of a folder's repository, whether or not a session has ever been started
   * in it — the folder menu's "Show all worktrees". `path` is checked against a stored project row
   * like every renderer-supplied path; the worktrees reported are remembered on the resolver, so
   * starting a session in one (`newSessionInProject`) accepts a path the main process derived
   * itself from git rather than one the renderer made up. Not a repository, or git failing, is
   * simply no worktrees.
   */
  async listWorktrees(path: string): Promise<FolderWorktree[]> {
    const folder = this.resolver.requireFolder(path)
    const all = await branchOps.listWorktrees(folder).catch(() => [])
    const others = all.filter((w) => w.path !== folder && existsSync(w.path))
    for (const w of others) this.resolver.rememberWorktree(w.path)
    return others
  }

  async push(key: string, isPtyId: boolean): Promise<{ commits: number; published: boolean }> {
    return branchOps.push(this.resolver.resolveShellCwd(key, isPtyId))
  }

  async merge(key: string, isPtyId: boolean, ref: string): Promise<void> {
    await branchOps.merge(this.resolver.resolveShellCwd(key, isPtyId), ref)
  }

  async fetch(key: string, isPtyId: boolean): Promise<void> {
    await branchOps.fetch(this.resolver.resolveShellCwd(key, isPtyId))
  }
}
