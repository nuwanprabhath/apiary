import { IPC } from '@shared/api'
import type { AppService } from '../../appService'
import { broadcast } from '../../windows/broadcast'
import type { Handlers } from '../registrar'
import type { GitTarget } from '@shared/domain/git'

export interface GitDeps {
  service: AppService
}

type HandledKeys =
  | 'gitStatus' | 'gitListRefs' | 'gitlabMrRefStatus' | 'gitCheckoutBranch' | 'gitCheckoutBranchMovingOther' | 'gitPullWorktree'
  | 'newSessionInWorktree' | 'gitCheckoutRemote' | 'gitCheckoutDetached' | 'gitCreateBranch' | 'gitPull'
  | 'gitUpdateBranch' | 'gitPullFolder' | 'listWorktrees' | 'gitPush' | 'gitMerge' | 'gitFetch'
  | 'worktreeCreateOptions' | 'worktreeCreate'
  | 'vsCodeAvailable' | 'openInVsCode' | 'openMentionedFile'

export function gitHandlers(deps: GitDeps): Pick<Handlers, HandledKeys> {
  const { service } = deps

  /**
   * `buildTree.ts` reads only a project's `branch` column, so a mutation that cannot change the
   * checked-out branch (fetch, merge, pull) skips the re-resolve. The broadcast always goes out:
   * the plugin bar and MR-status invalidation listen for `treeChanged`.
   */
  const afterGitMutation = async (
    target: GitTarget, branchMayChange: boolean,
  ): Promise<void> => {
    if (branchMayChange) await service.refreshProjectByKey(target)
    broadcast(IPC.treeChanged)
  }

  return {
    gitStatus: (_e, terminal) => service.gitStatus(terminal),
    gitListRefs: (_e, terminal) => service.gitListRefs(terminal),
    gitlabMrRefStatus: (_e, terminal, iids) =>
      // `iids` builds a `projects/.../merge_requests/<iid>` glab argument (mrStatusCache.ts); a
      // non-integer would be a nonsense lookup rather than a dangerous one, but there is no reason
      // to pass one through, and the cap keeps one call from asking `glab` about an unbounded list.
      service.gitlabMrRefStatus(terminal, iids.filter((iid) => Number.isSafeInteger(iid)).slice(0, 50)),
    gitCheckoutBranch: async (_e, terminal, name) => {
      const outcome = await service.gitCheckoutBranch(terminal, name)
      // Skipped when nothing was actually checked out (the worktree-conflict outcome).
      if (outcome.ok) await afterGitMutation(terminal, true)
      return outcome
    },
    gitCheckoutBranchMovingOther: async (_e, target, branch, otherTo) => {
      await service.gitCheckoutBranchMovingOther(target, branch, otherTo)
      await afterGitMutation(target, true)
    },
    gitPullWorktree: async (_e, terminal, branch) => {
      const outcome = await service.gitPullWorktree(terminal, branch)
      await afterGitMutation(terminal, false)
      return outcome
    },
    newSessionInWorktree: (_e, terminal, branch) => service.newSessionInWorktree(terminal, branch),
    gitCheckoutRemote: async (_e, terminal, remoteRef, localName) => {
      await service.gitCheckoutRemote(terminal, remoteRef, localName)
      await afterGitMutation(terminal, true)
    },
    gitCheckoutDetached: async (_e, terminal, ref) => {
      await service.gitCheckoutDetached(terminal, ref)
      await afterGitMutation(terminal, true)
    },
    gitCreateBranch: async (_e, terminal, name, from) => {
      await service.gitCreateBranch(terminal, name, from)
      await afterGitMutation(terminal, true)
    },
    gitPull: (_e, terminal) => service.gitPull(terminal),
    gitUpdateBranch: (_e, terminal, branch) => service.gitUpdateBranch(terminal, branch),
    gitPullFolder: async (_e, path) => {
      const outcome = await service.gitPullFolder(path)
      // A no-op pull happens on every hover-card poll, so broadcast only when commits arrived.
      if (outcome.commits > 0) broadcast(IPC.treeChanged)
      return outcome
    },
    listWorktrees: (_e, path) => service.listWorktrees(path),
    worktreeCreateOptions: (_e, path) => service.worktreeCreateOptions(path),
    worktreeCreate: (_e, path, request) => service.createWorktree(path, request),
    gitPush: (_e, terminal) => service.gitPush(terminal),
    gitMerge: async (_e, terminal, ref) => {
      await service.gitMerge(terminal, ref)
      await afterGitMutation(terminal, false)
    },
    gitFetch: async (_e, terminal) => {
      await service.gitFetch(terminal)
      await afterGitMutation(terminal, false)
    },
    vsCodeAvailable: () => service.vsCodeAvailable(),
    openInVsCode: (_e, terminal) => service.openInVsCode(terminal),
    openMentionedFile: (_e, terminal, mention) => service.openMentionedFile(terminal, mention),
  }
}
