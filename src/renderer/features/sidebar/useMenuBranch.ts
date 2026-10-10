import { useEffect, useState } from 'react'
import type { GitStatus, GitTarget } from '@shared/domain/git'
import type { SessionId } from '@shared/domain/ids'
import { updateBranchMessage } from '@shared/gitMessages'
import { gitUpdateBranch, readGitStatus } from '../../state/git'
import { surface } from '../../state/policy'
import { trackPull } from '../../state/gitActivity'
import type { ContextMenuItem } from '../../ui/contextMenuItem'
import type { useNotifications } from '../../ui/notifications'

/**
 * The branch of the folder a menu is open on, read through one of its sessions. `undefined` until
 * the read answers, and an answer counts only for the menu it was asked for, so the branch of an
 * earlier folder never shows.
 */
export function useMenuBranch(menu: object | null, session: SessionId | null): GitStatus | null | undefined {
  const [read, setRead] = useState<{ menu: object; status: GitStatus | null } | null>(null)
  useEffect(() => {
    if (menu === null || session === null) return undefined
    let live = true
    void readGitStatus({ kind: 'session', id: session }).then((status) => {
      if (live) setRead({ menu, status })
    })
    return () => { live = false }
  }, [menu, session])
  return read !== null && read.menu === menu ? read.status : undefined
}

/** Pull for a folder's menu: its branch fast-forwarded from upstream, or the reason it cannot be. */
export function pullMenuItem(
  session: SessionId | null,
  read: GitStatus | null | undefined,
  notify: ReturnType<typeof useNotifications>['notify'],
  pulling: boolean,
): ContextMenuItem {
  const blocked = (reason: string): ContextMenuItem => ({
    id: 'pull', label: 'Pull', disabled: true, disabledReason: reason, run: () => undefined,
  })
  if (session === null) return blocked('Pulling needs a session in this worktree')
  if (read === undefined) return blocked("Checking this worktree's branch…")
  if (read === null) return blocked("Could not read this worktree's branch")
  if (read.branch === null) return blocked('This worktree is not on a branch')
  if (!read.hasUpstream) return blocked(`${read.branch} has no upstream to pull from`)
  if (pulling) return blocked('Pulling…')
  const target: GitTarget = { kind: 'session', id: session }
  const { branch } = read
  return {
    id: 'pull',
    label: 'Pull',
    run: () => {
      surface(trackPull(branch, gitUpdateBranch(target, branch)).then(({ commits }) => {
        notify({ kind: 'success', message: updateBranchMessage(branch, commits) })
      }), 'Pull failed')
    },
  }
}
