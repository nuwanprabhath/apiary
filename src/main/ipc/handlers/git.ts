import { CHANNELS } from '@shared/api'
import type { AppService } from '../../appService'
import { broadcast } from '../../windows/broadcast'
import type { Handlers } from '../registrar'
import type { TerminalRef } from '@shared/domain/ids'

export interface GitDeps {
  service: AppService
}

type HandledKeys =
  | 'gitStatus' | 'gitListRefs' | 'gitlabMrRefStatus' | 'gitCheckoutBranch' | 'gitPullWorktree'
  | 'newSessionInWorktree' | 'gitCheckoutRemote' | 'gitCheckoutDetached' | 'gitCreateBranch' | 'gitPull'
  | 'gitUpdateBranch' | 'gitPullFolder' | 'listWorktrees' | 'gitPush' | 'gitMerge' | 'gitFetch'
  | 'worktreeCreateOptions' | 'worktreeCreate'
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
    terminal: TerminalRef, branchMayChange: boolean,
  ): Promise<void> => {
    if (branchMayChange) await service.refreshProjectByKey(terminal)
    broadcast(CHANNELS.treeChanged)
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
    gitPullWorktree: async (_e, terminal, branch) => {
      const outcome = await service.gitPullWorktree(terminal, branch)
      // A fast-forward pull cannot change which branch is checked out, only its commit — nothing
      // `tree()` shows, so no re-resolve, just the broadcast every mutation sends.
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
      // New commits can only move the folder's branch forward, never change which one is checked
      // out, so nothing needs re-resolving — the broadcast is only worth sending when something on
      // screen actually changed (a no-op pull happens on every hover-card poll).
      if (outcome.commits > 0) broadcast(CHANNELS.treeChanged)
      return outcome
    },
    listWorktrees: (_e, path) => service.listWorktrees(path),
    worktreeCreateOptions: (_e, path) => service.worktreeCreateOptions(path),
    worktreeCreate: (_e, path, request) => service.createWorktree(path, request),
    gitPush: (_e, terminal) => service.gitPush(terminal),
    gitMerge: async (_e, terminal, ref) => {
      await service.gitMerge(terminal, ref)
      // A merge moves commits onto the current branch, never changes which one is current.
      await afterGitMutation(terminal, false)
    },
    gitFetch: async (_e, terminal) => {
      await service.gitFetch(terminal)
      // Fetch only updates remote-tracking refs; the checked-out branch cannot change.
      await afterGitMutation(terminal, false)
    },
    vsCodeAvailable: () => service.vsCodeAvailable(),
    openInVsCode: (_e, terminal) => service.openInVsCode(terminal),
  }
}
