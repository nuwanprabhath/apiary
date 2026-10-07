import { type JSX, useEffect, useMemo, useState } from 'react'
import type { NewSessionInfo } from '@shared/types'
import type { GitTarget } from '@shared/domain/git'
import { useNotifications } from '../../ui/notifications'
import { BranchSwitcher } from './BranchSwitcher'
import { WorktreeConflictDialog } from './WorktreeConflictDialog'
import { useWorktreeConflict } from './useWorktreeConflict'

/**
 * A sidebar folder's "Change branch…": the pane toolbar's branch switcher, pointed at the folder
 * itself, so a worktree's branch can change without a session open in it. A branch another
 * worktree has goes to the same conflict dialog the toolbar uses, where "Switch both" moves that
 * worktree to another branch and checks this one out in one go.
 */
export function FolderBranchDialog({ path, label, onClose, onSessionStarted }: {
  /** The folder's path as the tree has it; main checks it against its own project rows. */
  path: string
  label: string
  onClose: () => void
  /** "New session there" from the conflict dialog. */
  onSessionStarted: (info: NewSessionInfo) => void
}): JSX.Element | null {
  const { notify } = useNotifications()
  const target = useMemo<GitTarget>(() => ({ kind: 'folder', path }), [path])
  const [picking, setPicking] = useState(true)
  const git = useWorktreeConflict({ target, onSessionStarted, onCheckedOut: () => {} })
  const { worktreeConflict } = git

  // The switcher closes itself before it hands up a conflict, so "closed" only means done once no
  // conflict followed — and the conflict dialog closing (cancelled, or acted on) means done too.
  const done = !picking && worktreeConflict === null
  useEffect(() => { if (done) onClose() }, [done, onClose])

  if (picking) {
    return (
      <BranchSwitcher
        terminal={target}
        heading={`Change the branch of ${label}`}
        onClose={() => { setPicking(false) }}
        onCheckedOut={() => {}}
        onError={(message) => { notify({ kind: 'error', message }) }}
        onNotice={(message) => { notify({ kind: 'success', message }) }}
        onWorktreeConflict={git.setWorktreeConflict}
      />
    )
  }
  if (worktreeConflict === null) return null
  return (
    <WorktreeConflictDialog
      conflict={worktreeConflict}
      busy={git.worktreeBusy}
      onCancel={() => { git.setWorktreeConflict(null) }}
      onPull={() => { git.pullWorktreeBranch(worktreeConflict) }}
      onOpenSession={() => { git.openWorktreeSession(worktreeConflict) }}
      onMoveOther={(otherTo) => { git.moveOtherWorktree(worktreeConflict, otherTo) }}
    />
  )
}
