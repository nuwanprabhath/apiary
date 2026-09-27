import { CHANNELS } from '@shared/api'
import type { AppService } from '../../appService'
import { broadcast } from '../../windows/broadcast'
import type { Handlers } from '../registrar'

export interface GitDeps {
  service: AppService
}

type HandledKeys =
  | 'gitStatus' | 'gitListRefs' | 'gitlabMrRefStatus' | 'gitCheckoutBranch' | 'gitPullWorktree'
  | 'newSessionInWorktree' | 'gitCheckoutRemote' | 'gitCheckoutDetached' | 'gitCreateBranch' | 'gitPull'
  | 'gitUpdateBranch' | 'gitPullFolder' | 'listWorktrees' | 'gitPush' | 'gitMerge' | 'gitFetch'
  | 'vsCodeAvailable' | 'openInVsCode'

export function gitHandlers(deps: GitDeps): Pick<Handlers, HandledKeys> {
  const { service } = deps

  /**
   * The "rescan and broadcast" step every git mutation needs, done once instead of pasted at
   * every call site (MAIN-4). Before this, every one of these awaited a *full* library rescan —
   * every transcript re-read, every folder re-resolved — just to answer "what does the sidebar
   * show now", because `tree()`'s `branch` column is only ever written by `resolveProject`
   * (see CLAUDE.md's cwd-override section for the same principle applied to `cwd_override`).
   *
   * `branchMayChange` is the only thing that decides whether git needs asking again at all:
   * `buildTree.ts` reads a project's `branch` column and nothing else about its git state, so a
   * fetch, merge or plain pull — which can only move commits, never the checked-out branch name —
   * has nothing to re-resolve. The broadcast still goes out unconditionally, so anything else
   * listening for `treeChanged` (the plugin bar, MR-status invalidation) still hears about it.
   */
  const afterGitMutation = async (
    key: string, isPtyId: boolean, branchMayChange: boolean,
  ): Promise<void> => {
    if (branchMayChange) await service.refreshProjectByKey(key, isPtyId)
    broadcast(CHANNELS.treeChanged)
  }

  return {
    gitStatus: (_e, key, isPtyId) => service.gitStatus(key, isPtyId),
    gitListRefs: (_e, key, isPtyId) => service.gitListRefs(key, isPtyId),
    gitlabMrRefStatus: (_e, key, isPtyId, iids) =>
      // `iids` builds a `projects/.../merge_requests/<iid>` glab argument (mrStatusCache.ts); a
      // non-integer would be a nonsense lookup rather than a dangerous one, but there is no reason
      // to pass one through, and the cap keeps one call from asking `glab` about an unbounded list.
      service.gitlabMrRefStatus(key, isPtyId, iids.filter((iid) => Number.isSafeInteger(iid)).slice(0, 50)),
    gitCheckoutBranch: async (_e, key, isPtyId, name) => {
      const outcome = await service.gitCheckoutBranch(key, isPtyId, name)
      // Skipped when nothing was actually checked out (the worktree-conflict outcome).
      if (outcome.ok) await afterGitMutation(key, isPtyId, true)
      return outcome
    },
    gitPullWorktree: async (_e, key, isPtyId, branch) => {
      const outcome = await service.gitPullWorktree(key, isPtyId, branch)
      // A fast-forward pull cannot change which branch is checked out, only its commit — nothing
      // `tree()` shows, so no re-resolve, just the broadcast every mutation sends.
      await afterGitMutation(key, isPtyId, false)
      return outcome
    },
    newSessionInWorktree: (_e, key, isPtyId, branch) => service.newSessionInWorktree(key, isPtyId, branch),
    gitCheckoutRemote: async (_e, key, isPtyId, remoteRef, localName) => {
      await service.gitCheckoutRemote(key, isPtyId, remoteRef, localName)
      await afterGitMutation(key, isPtyId, true)
    },
    gitCheckoutDetached: async (_e, key, isPtyId, ref) => {
      await service.gitCheckoutDetached(key, isPtyId, ref)
      await afterGitMutation(key, isPtyId, true)
    },
    gitCreateBranch: async (_e, key, isPtyId, name, from) => {
      await service.gitCreateBranch(key, isPtyId, name, from)
      await afterGitMutation(key, isPtyId, true)
    },
    gitPull: (_e, key, isPtyId) => service.gitPull(key, isPtyId),
    gitUpdateBranch: (_e, key, isPtyId, branch) => service.gitUpdateBranch(key, isPtyId, branch),
    gitPullFolder: async (_e, path) => {
      const outcome = await service.gitPullFolder(path)
      // New commits can only move the folder's branch forward, never change which one is checked
      // out, so nothing needs re-resolving — the broadcast is only worth sending when something on
      // screen actually changed (a no-op pull happens on every hover-card poll).
      if (outcome.commits > 0) broadcast(CHANNELS.treeChanged)
      return outcome
    },
    listWorktrees: (_e, path) => service.listWorktrees(path),
    gitPush: (_e, key, isPtyId) => service.gitPush(key, isPtyId),
    gitMerge: async (_e, key, isPtyId, ref) => {
      await service.gitMerge(key, isPtyId, ref)
      // A merge moves commits onto the current branch, never changes which one is current.
      await afterGitMutation(key, isPtyId, false)
    },
    gitFetch: async (_e, key, isPtyId) => {
      await service.gitFetch(key, isPtyId)
      // Fetch only updates remote-tracking refs; the checked-out branch cannot change.
      await afterGitMutation(key, isPtyId, false)
    },
    vsCodeAvailable: () => service.vsCodeAvailable(),
    openInVsCode: (_e, key, isPtyId) => service.openInVsCode(key, isPtyId),
  }
}
