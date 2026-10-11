import type { SessionId } from '@shared/domain/ids'
import { useState } from 'react'
import type { ProjectNode } from '@shared/types'
import type { ContextMenuItem } from '../../ui/contextMenuItem'
import { useNotifications } from '../../ui/notifications'
import { useLayoutActions } from '../layout'
import type { GroupState } from '../../state/groups'
import { findFolder } from './treeUtils'
import {
  folderArrangeItems, gitFolderSession, groupMenuItems, isGitFolder, sessionMenuItems, showAllWorktreesItem,
  type FolderMenu, type SidebarMenu,
} from './sidebarMenuItems'
import type { GroupActions } from './useGroupActions'
import { useDialogActions } from '../dialogs'
import { pullMenuItem, useMenuBranch } from './useMenuBranch'
import { pullKey } from '../../state/gitActivity'
import { useActivityRunning } from '../../state/activityStore'

export type { SidebarMenu }

/** The sidebar's one context menu: what is open (`menu`/`setMenu`) and the items it shows. */
export function useSidebarMenu({
  tree, rawTree, pinned, groupState, showAllWorktrees, onToggleAllWorktrees, onForkSession, onReorderPinned, groups,
}: {
  tree: ProjectNode[]
  rawTree: ProjectNode[]
  pinned: string[]
  groupState: GroupState
  showAllWorktrees: string[]
  onToggleAllWorktrees: (path: string) => void
  onForkSession: (sessionId: SessionId) => void
  onReorderPinned: (id: string, beforeId: string) => void
  groups: GroupActions
}): { menu: SidebarMenu | null; setMenu: (menu: SidebarMenu | null) => void; menuItems: () => ContextMenuItem[] } {
  const { notify, notifyError } = useNotifications()
  const { requestPicker } = useLayoutActions()
  const { changeBranch } = useDialogActions()
  const [menu, setMenu] = useState<SidebarMenu | null>(null)
  const pullSession = menu?.kind === 'folder' ? gitFolderSession(rawTree, menu.id) : null
  const branchRead = useMenuBranch(menu, pullSession)
  const pulling = useActivityRunning(branchRead?.branch !== undefined && branchRead.branch !== null ? pullKey(branchRead.branch) : null)
  const { folderSiblings, reorderFolder } = groups

  const folderItems = (m: FolderMenu): ContextMenuItem[] => {
    const folder = m.id
    const siblings = folderSiblings(folder)
    const folderIndex = siblings?.indexOf(folder) ?? -1
    const node = findFolder(tree, folder) ?? findFolder(rawTree, folder)
    const isGit = node !== null && isGitFolder(node)
    const changeBranchItem: ContextMenuItem[] = isGit
      ? [{ id: 'change-branch', label: 'Change branch…', separator: m.nested !== true, run: () => { changeBranch(folder, node.label) } }]
      : []
    const pullItems: ContextMenuItem[] = isGit ? [pullMenuItem(pullSession, branchRead, notify, pulling)] : []
    if (m.nested === true) return [...changeBranchItem, ...pullItems]
    const moveItems: ContextMenuItem[] = [
      ...changeBranchItem,
      ...pullItems,
      {
        id: 'folder-move-up',
        label: 'Move up',
        disabled: siblings === null || folderIndex <= 0,
        run: () => { if (siblings !== null && folderIndex > 0) reorderFolder(folder, siblings[folderIndex - 1]) },
      },
      {
        id: 'folder-move-down',
        label: 'Move down',
        separator: true,
        disabled: siblings === null || folderIndex === -1 || folderIndex >= siblings.length - 1,
        run: () => { if (siblings !== null && folderIndex !== -1) reorderFolder(siblings[folderIndex + 1], folder) },
      },
    ]
    const worktreesItem = showAllWorktreesItem(folder, showAllWorktrees.includes(folder), { rawTree, onToggleAllWorktrees, notify, notifyError })
    return folderArrangeItems(m, groupState, groups, moveItems, worktreesItem)
  }

  const menuItems = (): ContextMenuItem[] => {
    if (menu === null) return []
    if (menu.kind === 'session') return sessionMenuItems(menu, { tree, pinned, onForkSession, onReorderPinned, requestPicker })
    if (menu.kind === 'folder') return folderItems(menu)
    return groupMenuItems(menu, groupState, groups)
  }

  return { menu, setMenu, menuItems }
}
