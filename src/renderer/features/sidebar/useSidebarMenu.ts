import type { SessionId } from '@shared/domain/ids'
import { useState } from 'react'
import type { ProjectNode } from '@shared/types'
import type { ContextMenuItem } from '../../ui/ContextMenu'
import { useNotifications } from '../../ui/notifications'
import { useLayoutActions } from '../layout/layoutContext'
import { deleteGroup, moveGroup, type GroupState } from './model/groups'
import { flattenTree } from '@shared/treeWalk'
import { findFolder } from './treeUtils'
import type { GroupActions } from './useGroupActions'
import { useDialogActions } from '../dialogs/useDialogs'
import { listFolderWorktrees } from '../../state/git'

/** Which menu is open, if any: a right-click on a folder, a group's header or a session row.
 *  `nested`: a folder inside another (a worktree under its repository). */
export type SidebarMenu = { x: number; y: number; nested?: boolean }
  & ({ kind: 'folder' | 'group'; id: string } | { kind: 'session'; id: SessionId })

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
  const {
    patchGroups, assignFolder, startNewGroup, setRenamingGroup, setRenameDraft, folderSiblings, reorderFolder,
  } = groups

  const menuItems = (): ContextMenuItem[] => {
    if (menu === null) return []
    if (menu.kind === 'session') {
      const session = flattenTree(tree).get(menu.id)
      // A pinned session can be reordered from its context menu, the keyboard-reachable
      // equivalent of dragging it in the Pinned section — see the drop handler there.
      const pinnedIndex = pinned.indexOf(menu.id)
      return [
        {
          id: 'fork-session',
          label: 'Fork session',
          run: () => onForkSession(menu.id),
        },
        {
          id: 'arrange',
          label: 'Arrange…',
          disabled: session === undefined,
          run: () => { if (session !== undefined) requestPicker({ kind: 'session', session }, { x: menu.x, y: menu.y }) },
        },
        ...(pinnedIndex === -1 ? [] : [
          {
            id: 'pinned-move-up',
            label: 'Move up in Pinned',
            separator: true,
            disabled: pinnedIndex <= 0,
            run: () => { onReorderPinned(menu.id, pinned[pinnedIndex - 1]) },
          },
          {
            id: 'pinned-move-down',
            label: 'Move down in Pinned',
            disabled: pinnedIndex >= pinned.length - 1,
            run: () => { onReorderPinned(pinned[pinnedIndex + 1], menu.id) },
          },
        ]),
      ]
    }
    if (menu.kind === 'folder') {
      const current = groupState.assignments[menu.id]
      const showingAll = showAllWorktrees.includes(menu.id)
      const folder = menu.id
      const siblings = folderSiblings(menu.id)
      const folderIndex = siblings?.indexOf(menu.id) ?? -1
      const node = findFolder(tree, folder) ?? findFolder(rawTree, folder)
      // Only a folder git knows: the same test the "+" button's worktree menu uses.
      const isGit = node !== null && (node.branch !== null || node.isWorktree || node.children.some((c) => c.isWorktree))
      const changeBranchItem: ContextMenuItem[] = isGit
        ? [{ id: 'change-branch', label: 'Change branch…', separator: menu.nested !== true, run: () => { changeBranch(folder, node.label) } }]
        : []
      if (menu.nested === true) return changeBranchItem
      return [
        ...changeBranchItem,
        {
          id: 'folder-move-up',
          label: 'Move up',
          disabled: siblings === null || folderIndex <= 0,
          run: () => { if (siblings !== null && folderIndex > 0) reorderFolder(menu.id, siblings[folderIndex - 1]) },
        },
        {
          id: 'folder-move-down',
          label: 'Move down',
          separator: true,
          disabled: siblings === null || folderIndex === -1 || folderIndex >= siblings.length - 1,
          run: () => { if (siblings !== null && folderIndex !== -1) reorderFolder(siblings[folderIndex + 1], menu.id) },
        },
        {
          id: 'show-all-worktrees',
          label: 'Show all worktrees',
          checked: showingAll,
          run: () => {
            onToggleAllWorktrees(folder)
            if (showingAll) return
            // Said out loud when there is nothing to add, or the tick would appear to do nothing.
            void listFolderWorktrees(folder).then((list) => {
              const withSessions = new Set(rawTree.find((n) => n.path === folder)?.children.map((c) => c.path))
              if (list.every((w) => withSessions.has(w.path))) {
                const label = rawTree.find((n) => n.path === folder)?.label ?? folder
                notify({
                  message: list.length === 0
                    ? `${label} has no other worktrees`
                    : `Every worktree of ${label} already has sessions`,
                })
              }
            }).catch((e: unknown) => { notifyError(e, 'Could not list the worktrees') })
          },
        },
        { id: 'new-group', label: 'New group from this folder…', separator: true, run: () => startNewGroup(menu.id) },
        ...groupState.groups
          .filter((g) => g.id !== current)
          .map((g) => ({ id: `move-${g.id}`, label: `Add to “${g.name}”`, run: () => assignFolder(menu.id, g.id) })),
        {
          id: 'remove-from-group',
          label: 'Remove from group',
          disabled: current === undefined,
          separator: true,
          run: () => assignFolder(menu.id, null),
        },
      ]
    }
    const index = groupState.groups.findIndex((g) => g.id === menu.id)
    return [
      {
        id: 'rename-group',
        label: 'Rename group…',
        run: () => {
          setRenamingGroup(menu.id)
          setRenameDraft(groupState.groups[index]?.name ?? '')
        },
      },
      { id: 'group-up', label: 'Move group up', disabled: index <= 0, run: () => patchGroups({ groups: moveGroup(groupState.groups, menu.id, -1) }) },
      {
        id: 'group-down',
        label: 'Move group down',
        disabled: index === -1 || index >= groupState.groups.length - 1,
        run: () => patchGroups({ groups: moveGroup(groupState.groups, menu.id, 1) }),
      },
      {
        id: 'delete-group',
        label: 'Delete group',
        separator: true,
        // The folders inside come back out as ungrouped: deleting a heading must never look like
        // deleting the things filed under it.
        run: () => {
          const next = deleteGroup(groupState.groups, groupState.assignments, menu.id)
          patchGroups({ groups: next.groups, assignments: next.assignments })
        },
      },
    ]
  }

  return { menu, setMenu, menuItems }
}
