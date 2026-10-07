import { useCallback, useState } from 'react'
import type { NewSessionInfo, WorktreeConflict } from '@shared/types'
import type { GitTarget } from '@shared/domain/git'
import { movedOtherMessage, worktreePullMessage } from '@shared/gitMessages'
import { useNotifications } from '../../ui/notifications'

export interface WorktreeConflictActions {
  /** A checkout refused because another worktree has the branch, and what is being done about it. */
  worktreeConflict: WorktreeConflict | null
  setWorktreeConflict: (conflict: WorktreeConflict | null) => void
  worktreeBusy: boolean
  pullWorktreeBranch: (conflict: WorktreeConflict) => void
  openWorktreeSession: (conflict: WorktreeConflict) => void
  /** Switches the worktree holding the branch to `otherTo`, then checks the branch out here. */
  moveOtherWorktree: (conflict: WorktreeConflict, otherTo: string) => void
}

/** The worktree-conflict dialog's follow-ups, for a pane's git toolbar or a sidebar folder. */
export function useWorktreeConflict({ target, onSessionStarted, onCheckedOut }: {
  target: GitTarget | null
  /** A session started from the dialog — same bookkeeping as "+". */
  onSessionStarted: (info: NewSessionInfo) => void
  /** This folder's branch changed ("Switch both"). */
  onCheckedOut: () => void
}): WorktreeConflictActions {
  const { notify, notifyError } = useNotifications()
  const [worktreeConflict, setWorktreeConflict] = useState<WorktreeConflict | null>(null)
  const [worktreeBusy, setWorktreeBusy] = useState(false)

  const pullWorktreeBranch = useCallback((conflict: WorktreeConflict): void => {
    if (target === null) return
    setWorktreeBusy(true)
    void window.apiary.gitPullWorktree(target, conflict.branch)
      .then(({ commits }) => {
        notify({ message: worktreePullMessage(conflict.branch, conflict.label, commits) })
        setWorktreeConflict(null)
      })
      .catch((e: unknown) => { notifyError(e, `Could not pull ${conflict.branch}`) })
      .finally(() => setWorktreeBusy(false))
  }, [target, notify, notifyError])

  const openWorktreeSession = useCallback((conflict: WorktreeConflict): void => {
    if (target === null) return
    setWorktreeBusy(true)
    void window.apiary.newSessionInWorktree(target, conflict.branch)
      .then((info) => {
        onSessionStarted(info)
        setWorktreeConflict(null)
      })
      .catch((e: unknown) => { notifyError(e, 'Could not start a session there') })
      .finally(() => setWorktreeBusy(false))
  }, [target, onSessionStarted, notifyError])

  const moveOtherWorktree = useCallback((conflict: WorktreeConflict, otherTo: string): void => {
    if (target === null) return
    setWorktreeBusy(true)
    void window.apiary.gitCheckoutBranchMovingOther(target, conflict.branch, otherTo)
      .then(() => {
        notify({ kind: 'success', message: movedOtherMessage(conflict.branch, conflict.label, otherTo) })
        setWorktreeConflict(null)
        onCheckedOut()
      })
      .catch((e: unknown) => { notifyError(e, `Could not switch ${conflict.label} to ${otherTo}`) })
      .finally(() => setWorktreeBusy(false))
  }, [target, onCheckedOut, notify, notifyError])

  return { worktreeConflict, setWorktreeConflict, worktreeBusy, pullWorktreeBranch, openWorktreeSession, moveOtherWorktree }
}
