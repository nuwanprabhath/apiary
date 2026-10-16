import type { ProjectNode, SessionNode } from '@shared/types'
import { orderFolders, type GroupState } from '../../state/groups'
import type { SharedTreeProps } from './FolderGroup'
import type { SidebarMenu } from './sidebarMenuItems'

/** What the tree props are built from: the sidebar's state and the actions it hands the tree. */
export interface TreeDeps {
  collapsed: Set<string>
  onCollapsedChange: (next: Set<string>) => void
  selectedId: string | null
  onSelect: (session: SessionNode) => void
  onNewSession: (path: string) => void
  onNewWorktree: (path: string, label: string) => void
  onDeleteSession: (session: SessionNode) => void
  onSplitSession: (session: SessionNode) => void
  pinnedSet: Set<string>
  onTogglePin: (session: SessionNode) => void
  onEditNote: (session: SessionNode) => void
  onReorderFolder: (path: string, beforePath: string) => void
  setMenu: (menu: SidebarMenu | null) => void
  onSessionMenu: (session: SessionNode, x: number, y: number) => void
  /** Resolved against the unfiltered tree — see `onSessionDrop` below. */
  activeSessionsById: Map<string, SessionNode>
  onSessionDropped: (session: SessionNode, folderPath: string) => void
  groupState: GroupState
  tabIndexFor: SharedTreeProps['rovingTabIndex']
}

/** The tree props every level shares, so the grouped and ungrouped renders cannot drift apart. */
export function buildTreeProps(d: TreeDeps): SharedTreeProps {
  return {
    collapsed: d.collapsed,
    onToggle: (path) => {
      const next = new Set(d.collapsed)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      d.onCollapsedChange(next)
    },
    selectedId: d.selectedId,
    onSelect: d.onSelect,
    onNewSession: d.onNewSession,
    onNewWorktree: d.onNewWorktree,
    onDeleteSession: d.onDeleteSession,
    onSplitSession: d.onSplitSession,
    pinned: d.pinnedSet,
    onTogglePin: d.onTogglePin,
    onEditNote: d.onEditNote,
    onReorderFolder: d.onReorderFolder,
    onFolderMenu: (path, x, y, nested) => d.setMenu({ kind: 'folder', id: path, x, y, nested }),
    onSessionMenu: d.onSessionMenu,
    // Resolved against the unfiltered tree so it does not depend on the search box being empty.
    onSessionDrop: (sessionId, folderPath) => {
      const session = d.activeSessionsById.get(sessionId)
      if (session !== undefined) d.onSessionDropped(session, folderPath)
    },
    orderFolders: (nodes: ProjectNode[]) => orderFolders(nodes, (n) => n.path, d.groupState.folderOrder),
    onCollapseBeneath: (path, beneath) => {
      const next = new Set(d.collapsed)
      for (const p of beneath) next.add(p)
      // Opened if closed: collapsing inside a closed folder would look like nothing happened.
      next.delete(path)
      d.onCollapsedChange(next)
    },
    rovingTabIndex: d.tabIndexFor,
  }
}
