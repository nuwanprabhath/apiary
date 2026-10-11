import type { JSX } from 'react'
import type { TerminalRef } from '@shared/domain/ids'
import { BranchSwitcher, WorktreeConflictDialog } from '../git'
import { useNotifications } from '../../ui/notifications'
import type { useGitActions } from './useGitActions'
import type { useGitStatus } from './useGitStatus'

interface Props {
  terminal: TerminalRef | null
  git: ReturnType<typeof useGitActions>
  gitStatus: ReturnType<typeof useGitStatus>['gitStatus']
  loadGitStatus: ReturnType<typeof useGitStatus>['loadGitStatus']
  shellKey: string | null
}

/** The branch picker and the worktree-conflict dialog a column raises from its git actions. */
export function ColumnGitDialogs({ terminal, git, gitStatus, loadGitStatus, shellKey }: Props): JSX.Element {
  // Failures go to the app-wide notification stack rather than an in-pane banner: a message that
  // only exists inside one column is easy to miss once you have switched to another.
  const { notify } = useNotifications()
  const { worktreeConflict } = git

  return (
    <>
      {git.branchPicker !== null && terminal !== null && (
        <BranchSwitcher
          // Remounts (resetting the query, step and error) if the active tab changes under the
          // open modal — e.g. another window switching it — rather than quietly going on showing
          // the wrong repo's branches (UI-15 item 3).
          key={terminal.id}
          terminal={terminal}
          mode={git.branchPicker === 'merge' ? 'merge' : 'checkout'}
          startAt={git.branchPicker === 'create' ? 'name' : 'list'}
          currentBranch={gitStatus?.branch ?? null}
          onClose={() => git.setBranchPicker(null)}
          onCheckedOut={loadGitStatus}
          onError={(message) => notify({ kind: 'error', message })}
          onNotice={(message) => notify({ kind: 'success', message })}
          onBranchUpdated={loadGitStatus}
          onWorktreeConflict={git.setWorktreeConflict}
        />
      )}

      {worktreeConflict !== null && shellKey !== null && (
        <WorktreeConflictDialog
          conflict={worktreeConflict}
          busy={git.worktreeBusy}
          onCancel={() => git.setWorktreeConflict(null)}
          onPull={() => git.pullWorktreeBranch(worktreeConflict)}
          onOpenSession={() => git.openWorktreeSession(worktreeConflict)}
          onMoveOther={(otherTo) => git.moveOtherWorktree(worktreeConflict, otherTo)}
        />
      )}
    </>
  )
}
