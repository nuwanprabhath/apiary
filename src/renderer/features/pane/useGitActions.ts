import { useCallback, useState } from 'react'
import type { GitStatus, NewSessionInfo } from '@shared/types'
import type { TerminalRef } from '@shared/domain/ids'
import { pullMessage, pushMessage } from '@shared/gitMessages'
import type { GitMenuItem } from '../git/GitMenu'
import { useWorktreeConflict, type WorktreeConflictActions } from '../git/useWorktreeConflict'
import { useNotifications } from '../../ui/notifications'
import { copyText } from '../../state/clipboard'
import { fetchRemote, gitPull, gitPush } from '../../state/git'

export interface GitActions extends WorktreeConflictActions {
  /** Which remote operation is running — each shells out to git and must not start twice. */
  gitBusy: 'pull' | 'push' | 'fetch' | null
  runGitAction: (kind: 'pull' | 'push' | 'fetch') => Promise<void>
  /** The branch picker serves two jobs: choosing a branch to check out, and choosing one to merge
   *  in. Null when closed, so one piece of state carries both "is it open" and "what for". */
  branchPicker: 'checkout' | 'merge' | 'create' | null
  setBranchPicker: (mode: 'checkout' | 'merge' | 'create' | null) => void
  gitMenuOpen: boolean
  setGitMenuOpen: (open: boolean | ((prev: boolean) => boolean)) => void
  /** The "..." menu's commands, as data. */
  gitMenuItems: GitMenuItem[]
}

/** Everything a pane's git toolbar and "..." menu do: pull, push, fetch, the branch picker and the
 *  worktree-conflict follow-ups. */
export function useGitActions({ terminal, gitStatus, loadGitStatus, onSessionStarted }: {
  terminal: TerminalRef | null
  gitStatus: GitStatus | null
  loadGitStatus: () => void
  /** A session started from the worktree-conflict dialog — same bookkeeping as "+". */
  onSessionStarted: (info: NewSessionInfo) => void
}): GitActions {
  const { notify, notifyError } = useNotifications()
  const [gitBusy, setGitBusy] = useState<'pull' | 'push' | 'fetch' | null>(null)
  const [branchPicker, setBranchPicker] = useState<'checkout' | 'merge' | 'create' | null>(null)
  const conflict = useWorktreeConflict({ target: terminal, onSessionStarted, onCheckedOut: loadGitStatus })
  const [gitMenuOpen, setGitMenuOpen] = useState(false)

  const runGitAction = useCallback(async (kind: 'pull' | 'push' | 'fetch') => {
    if (terminal === null) return
    setGitBusy(kind)
    try {
      // All three are silent when they succeed, which reads identically to nothing having
      // happened — the same confusion the Refresh button had before it grew a spinner. Pull and
      // push say how many commits moved, so "nothing to do" is distinguishable too.
      let message: string
      if (kind === 'pull') message = pullMessage((await gitPull(terminal)).commits)
      else if (kind === 'push') message = pushMessage(await gitPush(terminal))
      else {
        await fetchRemote(terminal)
        message = 'Fetched from remote.'
      }
      notify({ kind: 'success', message })
      loadGitStatus()
    } catch (e) {
      notifyError(e, kind === 'pull' ? 'Pull failed' : kind === 'push' ? 'Push failed' : 'Fetch failed')
    } finally {
      setGitBusy(null)
    }
  }, [terminal, loadGitStatus, notify, notifyError])

  /**
   * The "..." menu's commands, grouped the way VS Code groups its own: the everyday remote
   * operations first, then everything branch-shaped behind one submenu, then the odds and ends.
   * Kept as data rather than markup so adding a command later is one more entry here.
   */
  const gitMenuItems: GitMenuItem[] = [
    { id: 'pull', label: 'Pull', disabled: gitBusy !== null, run: () => { void runGitAction('pull') } },
    { id: 'push', label: 'Push', disabled: gitBusy !== null, run: () => { void runGitAction('push') } },
    { id: 'fetch', label: 'Fetch', disabled: gitBusy !== null, run: () => { void runGitAction('fetch') } },
    {
      id: 'branch',
      label: 'Branch',
      separatorBefore: true,
      submenu: [
        { id: 'branch-checkout', label: 'Checkout to...', run: () => setBranchPicker('checkout') },
        { id: 'branch-create', label: 'Create Branch...', run: () => setBranchPicker('create') },
        { id: 'branch-merge', label: 'Merge Branch...', run: () => setBranchPicker('merge') },
      ],
    },
    {
      id: 'copy-branch',
      label: 'Copy Branch Name',
      separatorBefore: true,
      disabled: gitStatus?.branch === null || gitStatus?.branch === undefined,
      run: () => {
        if (gitStatus?.branch !== null && gitStatus?.branch !== undefined) void copyText(gitStatus.branch)
      },
    },
  ]

  return { ...conflict, gitBusy, runGitAction, branchPicker, setBranchPicker, gitMenuOpen, setGitMenuOpen, gitMenuItems }
}
