import { useRef, useState } from 'react'
import type { ProjectNode, SessionNode } from '@shared/types'
import { onTreeKeyDown, rovingTabIndex } from '../../ui/Tree'
import type { GroupedFolders, GroupState } from './model/groups'
import type { SidebarMenu } from './useSidebarMenu'

/**
 * UI-27 steps 1-2: the folder/session/group hierarchy as one WAI-ARIA tree (group headers included
 * — a group is a treeitem whose children are the folders filed into it, same as a folder is a
 * treeitem whose children are its sessions and sub-worktrees). One tree rather than one per group:
 * a group is part of the same hierarchy the folders and sessions are, not an unrelated list the way
 * Active/Pinned/Recent are (each its own flat tree).
 *
 * `focusKey` is which item currently holds the tree's one Tab stop — `null` until a real focus
 * event names one, at which point it behaves exactly like a roving tabindex the user has already
 * moved through. Until then, the very first item (the first group's header, or the first ungrouped
 * folder) is it, computed from data already at hand rather than a DOM query.
 */
export function useMainTreeNav({
  arranged, collapsed, onCollapsedChange, groupState, patchGroups, sessionsById, onSelect, onSplitSession, setMenu,
}: {
  arranged: GroupedFolders<ProjectNode>
  collapsed: Set<string>
  onCollapsedChange: (next: Set<string>) => void
  groupState: GroupState
  patchGroups: (next: Partial<GroupState>) => void
  sessionsById: Map<string, SessionNode>
  onSelect: (session: SessionNode) => void
  onSplitSession: (session: SessionNode) => void
  setMenu: (menu: SidebarMenu) => void
}): {
  ref: React.RefObject<HTMLDivElement | null>
  tabIndexFor: (kind: 'group' | 'folder' | 'session', key: string) => number
  onFocus: (e: React.FocusEvent) => void
  onKeyDown: (e: React.KeyboardEvent) => void
} {
  const ref = useRef<HTMLDivElement>(null)
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const firstKey = arranged.groups.length > 0
    ? `group:${arranged.groups[0].group.id}`
    : arranged.ungrouped.length > 0 ? `folder:${arranged.ungrouped[0].path}` : null
  const tabIndexFor = (kind: 'group' | 'folder' | 'session', key: string): number =>
    rovingTabIndex(focusKey, firstKey, `${kind}:${key}`)

  const toggleFolderOpen = (path: string, open: boolean): void => {
    const next = new Set(collapsed)
    if (open) next.delete(path); else next.add(path)
    onCollapsedChange(next)
  }
  const toggleGroupOpen = (groupId: string, open: boolean): void => {
    patchGroups({
      collapsed: open
        ? groupState.collapsed.filter((id) => id !== groupId)
        : [...groupState.collapsed, groupId],
    })
  }

  const onFocus = (e: React.FocusEvent): void => {
    const item = (e.target as HTMLElement).closest('[role="treeitem"]')
    const kind = item?.getAttribute('data-tree-kind')
    const key = item?.getAttribute('data-tree-key')
    if (kind !== null && kind !== undefined && key !== null && key !== undefined) {
      setFocusKey(`${kind}:${key}`)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    const root = ref.current
    if (root === null) return
    onTreeKeyDown(e, root, {
      onEnter: (current) => {
        const kind = current.dataset.treeKind
        const key = current.dataset.treeKey
        if (key === undefined) return
        if (kind === 'session') {
          const session = sessionsById.get(key)
          if (session !== undefined) onSelect(session)
        } else if (kind === 'folder') {
          toggleFolderOpen(key, current.getAttribute('aria-expanded') !== 'true')
        } else if (kind === 'group') {
          toggleGroupOpen(key, current.getAttribute('aria-expanded') !== 'true')
        }
      },
      onShiftEnter: (current) => {
        if (current.dataset.treeKind !== 'session' || current.dataset.treeKey === undefined) return
        const session = sessionsById.get(current.dataset.treeKey)
        if (session !== undefined) onSplitSession(session)
      },
      onArrowRight: (current, movedToChild) => {
        if (movedToChild) return
        const kind = current.dataset.treeKind
        const key = current.dataset.treeKey
        if (key === undefined) return
        if (kind === 'folder' && current.getAttribute('aria-expanded') === 'false') toggleFolderOpen(key, true)
        else if (kind === 'group' && current.getAttribute('aria-expanded') === 'false') toggleGroupOpen(key, true)
      },
      onArrowLeft: (current) => {
        const kind = current.dataset.treeKind
        const key = current.dataset.treeKey
        if (key === undefined) return
        if (kind === 'folder' && current.getAttribute('aria-expanded') === 'true') toggleFolderOpen(key, false)
        else if (kind === 'group' && current.getAttribute('aria-expanded') === 'true') toggleGroupOpen(key, false)
        // Otherwise onTreeKeyDown has already moved focus to the parent, if there is one.
      },
      onContextMenuKey: (current, at) => {
        const kind = current.dataset.treeKind
        const key = current.dataset.treeKey
        if (key === undefined) return
        if (kind === 'session') setMenu({ kind: 'session', id: key, x: at.x, y: at.y })
        // Matches FolderHeader's own onContextMenu: only a depth-0 folder has a menu at all.
        else if (kind === 'folder' && current.dataset.depth === '0') setMenu({ kind: 'folder', id: key, x: at.x, y: at.y })
        else if (kind === 'group') setMenu({ kind: 'group', id: key, x: at.x, y: at.y })
      },
    })
  }

  return { ref, tabIndexFor, onFocus, onKeyDown }
}
