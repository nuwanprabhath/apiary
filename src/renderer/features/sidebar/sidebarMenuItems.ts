import type { SessionId } from '@shared/domain/ids'
import type { ProjectNode, SessionNode } from '@shared/types'
import type { ContextMenuItem } from '../../ui/contextMenuItem'
import { flattenTree } from '@shared/treeWalk'
import { listFolderWorktrees } from '../../state/git'
import { deleteGroup, moveGroup, type GroupState } from '../../state/groups'
import { findFolder } from './treeUtils'
import type { GroupActions } from './useGroupActions'

/** Only a folder git knows: the same test the "+" button's worktree menu uses. */
export function isGitFolder(node: ProjectNode): boolean {
  return node.branch !== null || node.isWorktree || node.children.some((c) => c.isWorktree)
}

/** The session a folder's git commands run through: any one in it, since they share its directory. */
export function gitFolderSession(rawTree: ProjectNode[], path: string): SessionId | null {
  const node = findFolder(rawTree, path)
  if (node === null || !isGitFolder(node)) return null
  return node.sessions[0]?.sessionId ?? null
}

type MenuPosition = { x: number; y: number; nested?: boolean }
export type SessionMenu = MenuPosition & { kind: 'session'; id: SessionId }
export type FolderMenu = MenuPosition & { kind: 'folder'; id: string }
export type GroupMenu = MenuPosition & { kind: 'group'; id: string }
/** Which menu is open: a right-click on a folder, a group's header or a session row.
 *  `nested`: a folder inside another (a worktree under its repository). */
export type SidebarMenu = SessionMenu | FolderMenu | GroupMenu

export function sessionMenuItems(
  menu: SessionMenu,
  d: {
    tree: ProjectNode[]
    pinned: string[]
    onForkSession: (sessionId: SessionId) => void
    onReorderPinned: (id: string, beforeId: string) => void
    onTogglePin: (session: SessionNode) => void
    requestPicker: (target: { kind: 'session'; session: SessionNode }, at: { x: number; y: number }) => void
  },
): ContextMenuItem[] {
  const { pinned, onReorderPinned } = d
  const session = flattenTree(d.tree).get(menu.id)
  // The keyboard-reachable equivalent of dragging it in the Pinned section.
  const pinnedIndex = pinned.indexOf(menu.id)
  return [
    {
      id: 'fork-session',
      label: 'Fork session',
      run: () => d.onForkSession(menu.id),
    },
    {
      id: 'arrange',
      label: 'Arrange…',
      disabled: session === undefined,
      run: () => { if (session !== undefined) d.requestPicker({ kind: 'session', session }, { x: menu.x, y: menu.y }) },
    },
    {
      id: pinnedIndex === -1 ? 'pin' : 'unpin',
      label: pinnedIndex === -1 ? 'Pin' : 'Unpin',
      separator: true,
      disabled: session === undefined,
      run: () => { if (session !== undefined) d.onTogglePin(session) },
    },
    ...(pinnedIndex === -1 ? [] : [
      {
        id: 'pinned-move-up',
        label: 'Move up in Pinned',
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

export function groupMenuItems(
  menu: GroupMenu,
  groupState: GroupState,
  { patchGroups, setRenamingGroup, setRenameDraft }: GroupActions,
): ContextMenuItem[] {
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

/** The "Show all worktrees" tick; says out loud when there is nothing to add, or the tick would appear to do nothing. */
export function showAllWorktreesItem(
  folder: string,
  showingAll: boolean,
  d: {
    rawTree: ProjectNode[]
    onToggleAllWorktrees: (path: string) => void
    notify: (n: { message: string }) => void
    notifyError: (e: unknown, what: string) => void
  },
): ContextMenuItem {
  return {
    id: 'show-all-worktrees',
    label: 'Show all worktrees',
    checked: showingAll,
    run: () => {
      d.onToggleAllWorktrees(folder)
      if (showingAll) return
      void listFolderWorktrees(folder).then((list) => {
        const withSessions = new Set(d.rawTree.find((n) => n.path === folder)?.children.map((c) => c.path))
        if (list.every((w) => withSessions.has(w.path))) {
          const label = d.rawTree.find((n) => n.path === folder)?.label ?? folder
          d.notify({
            message: list.length === 0
              ? `${label} has no other worktrees`
              : `Every worktree of ${label} already has sessions`,
          })
        }
      }).catch((e: unknown) => { d.notifyError(e, 'Could not list the worktrees') })
    },
  }
}

export function folderArrangeItems(
  menu: FolderMenu,
  groupState: GroupState,
  { assignFolder, startNewGroup }: GroupActions,
  moveItems: ContextMenuItem[],
  worktreesItem: ContextMenuItem,
): ContextMenuItem[] {
  const current = groupState.assignments[menu.id]
  return [
    ...moveItems,
    worktreesItem,
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
