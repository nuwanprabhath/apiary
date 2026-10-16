import { useState } from 'react'
import type { ProjectNode } from '@shared/types'
import {
  moveFolder, newGroupId, orderFolders, type GroupedFolders, type GroupState,
} from '../../state/groups'
import { allFolderPaths } from './treeUtils'

export interface GroupActions {
  patchGroups: (next: Partial<GroupState>) => void
  assignFolder: (path: string, groupId: string | null) => void
  startNewGroup: (withFolder: string) => void
  /** The group whose name is being edited in place, instead of through a modal. */
  renamingGroup: string | null
  setRenamingGroup: (id: string | null) => void
  renameDraft: string
  setRenameDraft: (draft: string) => void
  commitRename: (id: string) => void
  folderSiblings: (path: string) => string[] | null
  reorderFolder: (path: string, beforePath: string) => void
  /** The folders a group can hold: groups are a top-level arrangement, worktrees are not in them. */
  topLevelPaths: Set<string>
}

export function useGroupActions(
  groupState: GroupState,
  onGroupStateChange: (next: GroupState) => void,
  tree: ProjectNode[],
  arranged: GroupedFolders<ProjectNode>,
): GroupActions {
  const [renamingGroup, setRenamingGroup] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')

  const patchGroups = (next: Partial<GroupState>): void => {
    onGroupStateChange({ ...groupState, ...next })
  }

  const assignFolder = (path: string, groupId: string | null): void => {
    const assignments = { ...groupState.assignments }
    if (groupId === null) delete assignments[path]
    else assignments[path] = groupId
    patchGroups({ assignments })
  }

  const startNewGroup = (withFolder: string): void => {
    const group = { id: newGroupId(), name: 'New group' }
    onGroupStateChange({
      ...groupState,
      groups: [...groupState.groups, group],
      assignments: { ...groupState.assignments, [withFolder]: group.id },
    })
    setRenamingGroup(group.id)
    setRenameDraft('New group')
  }

  const commitRename = (id: string): void => {
    const name = renameDraft.trim()
    setRenamingGroup(null)
    if (name === '') return
    patchGroups({ groups: groupState.groups.map((g) => (g.id === id ? { ...g, name } : g)) })
  }

  // In the order `SessionTree` renders them: a top-level folder's siblings are its group's
  // `folders` or `arranged.ungrouped`, never the whole tree.
  const folderSiblings = (path: string): string[] | null => {
    for (const { folders } of arranged.groups) {
      const ids = orderFolders(folders, (n) => n.path, groupState.folderOrder).map((n) => n.path)
      if (ids.includes(path)) return ids
    }
    const ids = orderFolders(arranged.ungrouped, (n) => n.path, groupState.folderOrder).map((n) => n.path)
    return ids.includes(path) ? ids : null
  }

  const topLevelPaths = new Set(tree.map((n) => n.path))

  const reorderFolder = (path: string, beforePath: string): void => {
    patchGroups({
      folderOrder: moveFolder(groupState.folderOrder, allFolderPaths(tree), path, beforePath),
    })
    // Dropping a top-level folder onto another files it into that one's group too. Nested folders
    // (worktrees) are in no group, so this applies only where both are top level.
    if (!topLevelPaths.has(path) || !topLevelPaths.has(beforePath)) return
    const target = groupState.assignments[beforePath]
    if (target !== groupState.assignments[path]) assignFolder(path, target ?? null)
  }

  return {
    patchGroups, assignFolder, startNewGroup, renamingGroup, setRenamingGroup, renameDraft, setRenameDraft,
    commitRename, folderSiblings, reorderFolder, topLevelPaths,
  }
}
