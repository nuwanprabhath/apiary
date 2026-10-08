import type { TerminalRef } from '@shared/domain/ids'
import type {
  CheckoutOutcome, FolderWorktree, GitRefs, GitStatus, GitTarget, WorktreeCreateOptions, WorktreeCreateRequest,
} from '@shared/domain/git'
import type { NewSessionInfo } from '@shared/domain/session'
import { bestEffort } from './policy'

/**
 * Commands on a repository, addressed by the tab's `TerminalRef`/`GitTarget`. Every one of them
 * runs git and can fail with git's own message, so they return their promise (policy 3,
 * `policy.ts`): the toolbar, branch picker and dialogs each show that message where the user is
 * looking. Only the two reads a poll or a list makes are best-effort.
 */

/** The branch of what is in front of a pane; null when it is not a repository or could not be read. */
export const readGitStatus = (terminal: TerminalRef): Promise<GitStatus | null> =>
  bestEffort(window.apiary.gitStatus(terminal), 'git')

export const gitRefs = (target: GitTarget): Promise<GitRefs> => window.apiary.gitListRefs(target)
export const listFolderWorktrees = (path: string): Promise<FolderWorktree[]> => window.apiary.listWorktrees(path)
/** A folder's other worktrees; none when git could not say. */
export const worktreesOf = (path: string): Promise<FolderWorktree[]> =>
  bestEffort(window.apiary.listWorktrees(path), 'git').then((list) => list ?? [])

export const gitPull = (terminal: TerminalRef): Promise<{ commits: number }> => window.apiary.gitPull(terminal)
export const gitPush = (terminal: TerminalRef): Promise<{ commits: number; published: boolean }> => window.apiary.gitPush(terminal)
export const fetchRemote = (terminal: TerminalRef): Promise<void> => window.apiary.gitFetch(terminal)
export const pullFolder = (path: string): Promise<{ commits: number }> => window.apiary.gitPullFolder(path)
export const gitUpdateBranch = (target: GitTarget, branch: string): Promise<{ commits: number }> =>
  window.apiary.gitUpdateBranch(target, branch)

export const gitCheckout = (target: GitTarget, name: string): Promise<CheckoutOutcome> =>
  window.apiary.gitCheckoutBranch(target, name)
export const gitCheckoutRemote = (target: GitTarget, remoteRef: string, localName: string): Promise<void> =>
  window.apiary.gitCheckoutRemote(target, remoteRef, localName)
export const gitCheckoutDetached = (target: GitTarget, ref: string): Promise<void> =>
  window.apiary.gitCheckoutDetached(target, ref)
export const gitCreateBranch = (target: GitTarget, name: string, from?: string): Promise<void> =>
  window.apiary.gitCreateBranch(target, name, from)
export const mergeRef = (target: GitTarget, ref: string): Promise<void> => window.apiary.gitMerge(target, ref)

/** The worktree-conflict dialog's three follow-ups. */
export const pullBranchInWorktree = (target: GitTarget, branch: string): Promise<{ path: string; commits: number }> =>
  window.apiary.gitPullWorktree(target, branch)
export const startSessionInWorktree = (target: GitTarget, branch: string): Promise<NewSessionInfo> =>
  window.apiary.newSessionInWorktree(target, branch)
export const checkoutBranchMovingOther = (target: GitTarget, branch: string, otherTo: string): Promise<void> =>
  window.apiary.gitCheckoutBranchMovingOther(target, branch, otherTo)

export const worktreeCreateOptions = (path: string): Promise<WorktreeCreateOptions> => window.apiary.worktreeCreateOptions(path)
export const createWorktree = (path: string, request: WorktreeCreateRequest): Promise<NewSessionInfo> =>
  window.apiary.worktreeCreate(path, request)
