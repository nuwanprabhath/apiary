import { existsSync, readdirSync } from 'node:fs'
import { errorMessage } from '@shared/errors'
import { basename, join } from 'node:path'
import { isWorktreeConflict, type BranchOps } from './branchOps'
import { resolveRemote } from '../plugins/remote'
import { parseGitLabRemote } from '../plugins/gitlabRemote'
import type { MrState, MrStatusCache } from './mrStatusCache'
import { log } from '../log/logger'
import type { SessionResolver } from '../sessions/sessionResolver'
import type { TerminalRef } from '@shared/domain/ids'
import type { GitStatus, GitRefs, CheckoutOutcome, FolderWorktree, NewSessionInfo } from '@shared/types'
import {
  worktreeNameProblem, type GitTarget, type WorktreeCreateOptions, type WorktreeCreateRequest,
} from '@shared/domain/git'

export interface GitServiceDeps {
  resolver: SessionResolver
  /** Every branch/worktree/remote `git` operation, over the container's `exec`. */
  branchOps: BranchOps
  /** Merge-request states and their cache. */
  mrStatus: MrStatusCache
  /** Re-resolves one folder's project row through git (`SessionCatalog.refreshProject`). */
  refreshProject: (cwd: string) => Promise<void>
  /** Starts a Claude session in a folder this service derived itself (`TerminalService.newSessionInFolder`). */
  startSessionIn: (folder: string) => Promise<NewSessionInfo>
  /** Path to the `glab` executable, for anyone whose install is not on PATH (and for tests). */
  glabPath?: string
}

/**
 * Every `git*` operation, and the GitLab MR-reference resolver. Every cwd comes from
 * `resolver.resolveShellCwd`/`requireFolder`: no raw renderer path reaches git.
 */
export class GitService {
  private readonly resolver: SessionResolver
  private readonly branchOps: BranchOps
  private readonly mrStatus: MrStatusCache
  private readonly glabPath: string | undefined
  private readonly refreshProject: (cwd: string) => Promise<void>
  private readonly startSessionIn: (folder: string) => Promise<NewSessionInfo>
  /** Each folder's branch as last seen by `status()`, so plugins need no `git` call of their own. */
  private readonly lastBranch = new Map<string, string | null>()

  constructor(deps: GitServiceDeps) {
    this.resolver = deps.resolver
    this.branchOps = deps.branchOps
    this.mrStatus = deps.mrStatus
    this.glabPath = deps.glabPath
    this.refreshProject = deps.refreshProject
    this.startSessionIn = deps.startSessionIn
  }

  /** Forgets every cached merge-request state: the Refresh button asks GitLab again. */
  invalidateMrStatuses(): void {
    this.mrStatus.invalidate()
  }

  /** The branch as of the last `status()` call; null if none was made or it is not a repository. */
  lastBranchFor(cwd: string): string | null {
    return this.lastBranch.get(cwd) ?? null
  }

  /**
   * The folder a git call acts on. A session or terminal goes through `resolveShellCwd`; a sidebar
   * folder's path came from the renderer, so it must be a stored project row (`requireFolder`) or
   * a worktree `listWorktrees` found in git.
   */
  cwdOf(target: GitTarget): string {
    if (target.kind !== 'folder') return this.resolver.resolveShellCwd(target)
    // A worktree "Show all worktrees" listed has no project row until a session starts there.
    const folder = this.resolver.isKnownWorktree(target.path) ? target.path : this.resolver.requireFolder(target.path)
    if (!existsSync(folder)) throw new Error(`This folder no longer exists: ${folder}`)
    return folder
  }

  /** Null means `cwd` is not (or is no longer) a git repository — an outcome, not a failure.
   *  Anything else `git` gets wrong there still rejects. */
  async status(terminal: TerminalRef): Promise<GitStatus | null> {
    const cwd = this.resolver.resolveShellCwd(terminal)
    const status = await this.branchOps.status(cwd)
    this.lastBranch.set(cwd, status?.branch ?? null)
    return status
  }

  async listRefs(target: GitTarget): Promise<GitRefs> {
    return this.branchOps.listRefs(this.cwdOf(target))
  }

  /**
   * Resolves each `!<iid>` in a session's title or note against its GitLab remote through `glab`,
   * never a stored token. No remote, no `glab`, a non-zero exit or a timeout map every iid to
   * `null` rather than throwing.
   */
  async mrRefStatus(
    terminal: TerminalRef, iids: number[],
  ): Promise<Record<number, MrState | null>> {
    const cwd = this.resolver.resolveShellCwd(terminal)
    const out: Record<number, MrState | null> = {}
    const remote = await resolveRemote(cwd, parseGitLabRemote)
    if (remote === null) {
      for (const iid of iids) out[iid] = null
      return out
    }
    await Promise.all(iids.map(async (iid) => {
      out[iid] = await this.mrStatus.resolve(cwd, remote.host, remote.project, iid, { glabPath: this.glabPath })
    }))
    return out
  }

  /**
   * Checks out a branch. Git refusing because another worktree has it is the normal answer with a
   * worktree per ticket, so it is an outcome the UI can act on (update it there, or open a
   * session there), not an error. The path comes from `git worktree list --porcelain`, not the
   * message, so the app only acts on a path main derived itself.
   */
  async checkoutBranch(target: GitTarget, name: string): Promise<CheckoutOutcome> {
    const cwd = this.cwdOf(target)
    try {
      await this.branchOps.checkoutBranch(cwd, name)
      return { ok: true }
    } catch (e) {
      const message = errorMessage(e)
      if (!isWorktreeConflict(message)) throw e
      const worktreePath = await this.branchOps.worktreeForBranch(cwd, name)
      log.info('git', 'checkout refused: branch is in another worktree', {
        branch: name, cwd, worktreePath,
      })
      // Git said a worktree has it but the list disagrees: let git's own error through.
      if (worktreePath === null) throw e
      const { current, choices } = await this.choicesFor(cwd).catch(() => ({ current: null, choices: [] }))
      return { ok: false, conflict: { branch: name, worktreePath, label: basename(worktreePath), current, choices } }
    }
  }

  /** The worktree holding `branch`. The renderer names the branch, never the path, and the answer is re-derived each time: a worktree can be removed between the refusal and the click. */
  async requireWorktreeFor(target: GitTarget, branch: string): Promise<string> {
    return this.worktreeHolding(this.cwdOf(target), branch)
  }

  private async worktreeHolding(cwd: string, branch: string): Promise<string> {
    const path = await this.branchOps.worktreeForBranch(cwd, branch)
    if (path === null) {
      throw new Error(`${branch} is no longer checked out in a worktree of this repository`)
    }
    if (!existsSync(path)) throw new Error(`That worktree no longer exists: ${path}`)
    return path
  }

  /** Pulls `branch` in the worktree that has it, which is the only place it *can* be pulled. */
  async pullWorktree(
    target: GitTarget, branch: string,
  ): Promise<{ path: string; commits: number }> {
    const path = await this.requireWorktreeFor(target, branch)
    const { commits } = await this.branchOps.pull(path)
    return { path, commits }
  }

  /**
   * Checks `branch` out in `target` after switching the worktree that has it to `otherTo`. When
   * `otherTo` is the branch checked out here (a swap), this folder detaches first and takes it
   * back if the other worktree cannot switch. Git's refusal rejects; the other worktree's path is
   * returned so its row can be refreshed.
   */
  async checkoutMovingOther(target: GitTarget, branch: string, otherTo: string): Promise<string> {
    const cwd = this.cwdOf(target)
    const other = await this.worktreeHolding(cwd, branch)
    const here = (await this.branchOps.status(cwd))?.branch ?? null
    const swap = here === otherTo
    if (swap) await this.branchOps.checkoutDetached(cwd, 'HEAD')
    try {
      await this.branchOps.checkoutBranch(other, otherTo)
    } catch (e) {
      // A failed rollback is logged so it does not replace the error the caller sees.
      if (swap) {
        await this.branchOps.checkoutBranch(cwd, otherTo).catch((err: unknown) => {
          log.warn('git', 'could not restore the branch after a failed swap', { error: errorMessage(err) })
        })
      }
      throw e
    }
    await this.branchOps.checkoutBranch(cwd, branch)
    log.info('git', 'checked out after moving the other worktree', { branch, swap })
    return other
  }

  /** `checkoutMovingOther`, then both rows re-resolved: the other worktree's branch changed too. */
  async checkoutBranchMovingOther(target: GitTarget, branch: string, otherTo: string): Promise<void> {
    await this.refreshProject(await this.checkoutMovingOther(target, branch, otherTo))
  }

  /** One folder's project row re-resolved through git, for a call that named it by `target`. */
  async refreshProjectOf(target: GitTarget): Promise<void> {
    await this.refreshProject(this.cwdOf(target))
  }

  /** Starts a new Claude session in the worktree that has `branch`. */
  async newSessionInWorktree(target: GitTarget, branch: string): Promise<NewSessionInfo> {
    return this.startSessionIn(await this.requireWorktreeFor(target, branch))
  }

  /** New worktree, then a Claude session in it — Apiary's "open" for a fresh worktree. The path
   *  comes back from git, never from the renderer, which is what makes starting a session in it safe. */
  async createWorktreeSession(path: string, request: WorktreeCreateRequest): Promise<NewSessionInfo> {
    return this.startSessionIn(await this.createWorktree(path, request))
  }

  /** What `WorktreeConflict.choices` offers, for a checkout refused in `cwd`. */
  private async choicesFor(cwd: string): Promise<{ current: string | null; choices: string[] }> {
    const [worktrees, refs] = await Promise.all([this.branchOps.listWorktrees(cwd), this.branchOps.listRefs(cwd)])
    const taken = new Set(worktrees.map((w) => w.branch).filter((b): b is string => b !== null))
    const free = refs.local.map((r) => r.name).filter((n) => !taken.has(n))
    return { current: refs.current, choices: refs.current === null ? free : [refs.current, ...free] }
  }

  async checkoutRemote(target: GitTarget, remoteRef: string, localName: string): Promise<void> {
    await this.branchOps.checkoutRemote(this.cwdOf(target), remoteRef, localName)
  }

  async checkoutDetached(target: GitTarget, ref: string): Promise<void> {
    await this.branchOps.checkoutDetached(this.cwdOf(target), ref)
  }

  async createBranch(target: GitTarget, name: string, from?: string): Promise<void> {
    await this.branchOps.createBranch(this.cwdOf(target), name, from)
  }

  async pull(terminal: TerminalRef): Promise<{ commits: number }> {
    return this.branchOps.pull(this.resolver.resolveShellCwd(terminal))
  }

  /** Fast-forwards any local branch from its upstream (the branch list's pull button). */
  async updateBranch(target: GitTarget, branch: string): Promise<{ commits: number }> {
    return this.branchOps.updateBranch(this.cwdOf(target), branch)
  }

  /** Fast-forwards a folder's branch (the hover card's pull button); `path` is checked against a stored project row. */
  async pullFolder(path: string): Promise<{ commits: number }> {
    return this.branchOps.pullFastForward(this.resolver.requireFolder(path))
  }

  /**
   * Every other worktree of a folder's repository (the folder menu's "Show all worktrees"). They
   * are remembered on the resolver so `newSessionInProject` accepts a path derived from git. Not
   * a repository, or git failing, is simply no worktrees.
   */
  async listWorktrees(path: string): Promise<FolderWorktree[]> {
    const folder = this.resolver.requireFolder(path)
    const all = await this.branchOps.listWorktrees(folder).catch(() => [])
    const others = all.filter((w) => w.path !== folder && existsSync(w.path))
    for (const w of others) this.resolver.rememberWorktree(w.path)
    return others
  }

  /** What the New worktree dialog offers; every path is derived from git, so the renderer never names where a worktree goes. */
  async worktreeCreateOptions(path: string): Promise<WorktreeCreateOptions> {
    const folder = this.resolver.requireFolder(path)
    const all = await this.branchOps.listWorktrees(folder)
    // `git worktree list` always lists the main checkout first.
    const parentDir = `${all[0]?.path ?? folder}.worktrees`
    const existingNames = existsSync(parentDir) ? readdirSync(parentDir) : []
    const { local, remote } = await this.branchOps.listBranchNames(folder)
    const checkedOut = all.map((w) => w.branch).filter((b): b is string => b !== null)
    return { parentDir, existingNames, local, remote, checkedOut }
  }

  /** Creates the worktree and returns its path. Checks everything the dialog checked, again. */
  async createWorktree(path: string, request: WorktreeCreateRequest): Promise<string> {
    const folder = this.resolver.requireFolder(path)
    const options = await this.worktreeCreateOptions(folder)
    const name = request.name.trim()
    const problem = worktreeNameProblem(name, options.existingNames)
    if (problem !== null) throw new Error(problem)
    const choice = request.branch
    if (choice.kind === 'local' && options.checkedOut.includes(choice.branch)) {
      throw new Error(`Branch '${choice.branch}' is already checked out in another worktree. Git only allows a branch in one worktree at a time.`)
    }
    if (choice.kind === 'new' && options.local.includes(choice.branch.trim())) {
      throw new Error(`A local branch named '${choice.branch.trim()}' already exists.`)
    }
    const target = join(options.parentDir, name)
    const normalised = choice.kind === 'new' ? { ...choice, branch: choice.branch.trim() } : choice
    await this.branchOps.addWorktree(folder, target, normalised, options.local)
    log.info('git', 'worktree created', { kind: choice.kind })
    this.resolver.rememberWorktree(target)
    return target
  }

  async push(terminal: TerminalRef): Promise<{ commits: number; published: boolean }> {
    return this.branchOps.push(this.resolver.resolveShellCwd(terminal))
  }

  async merge(target: GitTarget, ref: string): Promise<void> {
    await this.branchOps.merge(this.cwdOf(target), ref)
  }

  async fetch(terminal: TerminalRef): Promise<void> {
    await this.branchOps.fetch(this.resolver.resolveShellCwd(terminal))
  }
}
