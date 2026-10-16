import { type JSX, useState } from 'react'
import type { ProjectNode, SessionNode } from '@shared/types'
import { SessionRow } from './SessionRow'
import { FolderHoverCard, FolderRowControls } from './FolderRowControls'
import { useHoverCard } from '../../ui/useHoverCard'


/** Every folder beneath these, at any depth — what "collapse all" folds. */
function descendantPaths(nodes: ProjectNode[], into: string[] = []): string[] {
  for (const node of nodes) {
    into.push(node.path)
    descendantPaths(node.children, into)
  }
  return into
}

interface Props {
  nodes: ProjectNode[]
  depth?: number
  collapsed: Set<string>
  onToggle: (path: string) => void
  selectedId: string | null
  onSelect: (session: SessionNode) => void
  onNewSession: (path: string) => void
  /** Opens the New worktree dialog for a git folder. Absent: "+" only starts a session. */
  onNewWorktree?: (path: string, label: string) => void
  /** Confirmation, if any, is the caller's concern. */
  onDeleteSession: (session: SessionNode) => void
  onSplitSession: (session: SessionNode) => void
  /** Session ids currently pinned. These are drawn in the sidebar's pinned section instead of
   *  here, so the same row is never listed twice. */
  pinned: Set<string>
  onTogglePin: (session: SessionNode) => void
  onEditNote: (session: SessionNode) => void
  /**
   * Drag-to-reorder, at every level. Ordering is stored by absolute path, which is unique across
   * the whole tree, so one list serves every level without them interfering.
   */
  onReorderFolder?: (path: string, beforePath: string) => void
  /** Filing into groups stays a top-level idea: a worktree belongs to its repository, not a group.
   *  So a nested folder's menu (`nested`) only has what applies to it — its branch: change it, pull it. */
  onFolderMenu?: (path: string, x: number, y: number, nested: boolean) => void
  onSessionMenu?: (session: SessionNode, x: number, y: number) => void
  orderFolders?: (nodes: ProjectNode[]) => ProjectNode[]
  /** Collapses every folder beneath `path`, leaving `path` itself open so what is left is the
   *  short list of its worktrees. */
  onCollapseBeneath?: (path: string, beneath: string[]) => void
  /** A session row was dropped on this folder — the drag-to-move gesture. Undefined disables
   *  accepting a session drop entirely (the flat search-result list has no folder rows to drop on). */
  onSessionDrop?: (sessionId: string, folderPath: string) => void
  /**
   * `aria-level` for this level's rows: 1 at the tree's root, one more per recursion. Kept apart
   * from `depth` (indentation and DnD grouping, 0 at the top of every section, groups included) so
   * a group header can add ARIA nesting without a visual indent.
   */
  level?: number
  /** Roving-tabindex value for a treeitem key — 0 for the tree's one Tab stop, -1 otherwise.
   *  Threaded down because it depends on what in the whole tree holds the stop. */
  rovingTabIndex?: (kind: 'folder' | 'session', key: string) => number
}

export function SessionTree({
  nodes, depth = 0, collapsed, onToggle, selectedId, onSelect, onNewSession, onNewWorktree, onDeleteSession,
  onSplitSession, pinned, onTogglePin, onEditNote, onReorderFolder, onFolderMenu,
  onSessionMenu, orderFolders, onCollapseBeneath, onSessionDrop, level = 1, rovingTabIndex,
}: Props): JSX.Element {
  const rearrangeable = onReorderFolder !== undefined
  const ordered = orderFolders === undefined ? nodes : orderFolders(nodes)
  // Only a folder's own children are a WAI-ARIA "group"; the outermost list sits directly under
  // the `role="tree"` container.
  return (
    <ul className="tree" role={depth === 0 ? undefined : 'group'} style={{ paddingLeft: depth === 0 ? 0 : 14 }}>
      {ordered.map((node) => {
        const isOpen = !collapsed.has(node.path)
        const childProjects = node.children
        // A folder whose every session is pinned still shows its header, and its "+" button.
        const unpinned = node.sessions.filter((s) => !pinned.has(s.sessionId))
        return (
          <li key={node.path} data-testid="project-group">
            <FolderHeader
              node={node}
              depth={depth}
              level={level}
              isOpen={isOpen}
              rearrangeable={rearrangeable}
              onToggle={onToggle}
              onNewSession={onNewSession}
              onNewWorktree={onNewWorktree}
              onReorderFolder={onReorderFolder}
              onFolderMenu={onFolderMenu}
              onCollapseBeneath={
                onCollapseBeneath !== undefined && childProjects.length > 0
                  ? () => { onCollapseBeneath(node.path, descendantPaths(childProjects)) }
                  : undefined
              }
              onSessionDrop={onSessionDrop}
              tabIndex={rovingTabIndex?.('folder', node.path) ?? -1}
            />

            {isOpen && (
              <>
                {unpinned.map((s) => (
                  <SessionRow
                    key={s.sessionId}
                    session={s}
                    selected={s.sessionId === selectedId}
                    pinned={false}
                    onSelect={onSelect}
                    onSplit={onSplitSession}
                    onDelete={onDeleteSession}
                    onTogglePin={onTogglePin}
                    onEditNote={onEditNote}
                    onMenu={onSessionMenu}
                    folderBranch={node.branch}
                    treeLevel={level + 1}
                    treeTabIndex={rovingTabIndex?.('session', s.sessionId) ?? -1}
                  />
                ))}
                {childProjects.length > 0 && (
                  <SessionTree
                    nodes={childProjects}
                    depth={depth + 1}
                    level={level + 1}
                    collapsed={collapsed}
                    onToggle={onToggle}
                    selectedId={selectedId}
                    onSelect={onSelect}
                    onNewSession={onNewSession}
              onNewWorktree={onNewWorktree}
                    onDeleteSession={onDeleteSession}
                    onSplitSession={onSplitSession}
                    pinned={pinned}
                    onTogglePin={onTogglePin}
                    onEditNote={onEditNote}
                    onReorderFolder={onReorderFolder}
                    onFolderMenu={onFolderMenu}
                    onSessionMenu={onSessionMenu}
                    orderFolders={orderFolders}
                    onCollapseBeneath={onCollapseBeneath}
                    onSessionDrop={onSessionDrop}
                    rovingTabIndex={rovingTabIndex}
                  />
                )}
              </>
            )}
          </li>
        )
      })}
    </ul>
  )
}

interface FolderHeaderProps {
  node: ProjectNode
  depth: number
  /** aria-level — see the note on `Props.level` above. */
  level: number
  isOpen: boolean
  rearrangeable: boolean
  onToggle: (path: string) => void
  onNewSession: (path: string) => void
  onNewWorktree?: (path: string, label: string) => void
  onReorderFolder?: (path: string, beforePath: string) => void
  onFolderMenu?: (path: string, x: number, y: number, nested: boolean) => void
  /** Present only on a folder that has folders beneath it. */
  onCollapseBeneath?: () => void
  onSessionDrop?: (sessionId: string, folderPath: string) => void
  tabIndex: number
}

/** The hover card carries the full path, since a worktree's label is only its last path segment. */
function FolderHeader({
  node, depth, level, isOpen, rearrangeable, onToggle, onNewSession, onNewWorktree, onReorderFolder, onFolderMenu,
  onCollapseBeneath, onSessionDrop, tabIndex,
}: FolderHeaderProps): JSX.Element {
  const isGit = node.branch !== null || node.isWorktree || node.children.some((c) => c.isWorktree)
  // A nested folder's menu would be "Change branch…" alone; one git does not know has none.
  const folderMenu = onFolderMenu !== undefined && (depth === 0 || isGit) ? onFolderMenu : undefined
  const card = useHoverCard<HTMLDivElement>()
  const [sessionOver, setSessionOver] = useState(false)
  return (
    <div
      ref={card.ref}
      className="project-row-wrap"
      data-folder-path={node.path}
      // Explicit because only the outermost level can be filed into a group, and a CSS selector
      // cannot tell the levels apart.
      data-depth={depth}
      data-own-context-menu={folderMenu === undefined ? undefined : true}
      data-drop-target={sessionOver}
      data-no-sessions={node.isWorktree && node.sessions.length === 0 && node.children.length === 0}
      role="treeitem"
      // Stable, like SessionRow's: the row's text also carries the branch name.
      aria-label={node.label}
      aria-expanded={isOpen}
      aria-level={level}
      data-tree-kind="folder"
      data-tree-key={node.path}
      tabIndex={tabIndex}
      draggable={rearrangeable}
      onMouseEnter={card.arm}
      onMouseLeave={card.scheduleClose}
      onMouseDown={card.hideNow}
      onDragStart={(e) => {
        if (!rearrangeable) return
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('application/x-apiary-folder', node.path)
      }}
      onDragOver={(e) => {
        if (rearrangeable && e.dataTransfer.types.includes('application/x-apiary-folder')) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          return
        }
        if (onSessionDrop !== undefined && e.dataTransfer.types.includes('application/x-apiary-session')) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          setSessionOver(true)
        }
      }}
      onDragLeave={() => setSessionOver(false)}
      onDrop={(e) => {
        if (onSessionDrop !== undefined && e.dataTransfer.types.includes('application/x-apiary-session')) {
          setSessionOver(false)
          const sessionId = e.dataTransfer.getData('application/x-apiary-session')
          if (sessionId !== '') { e.preventDefault(); onSessionDrop(sessionId, node.path) }
          return
        }
        if (onReorderFolder === undefined) return
        const dragged = e.dataTransfer.getData('application/x-apiary-folder')
        if (dragged === '' || dragged === node.path) return
        e.preventDefault()
        // A row inside a group is also inside the group's drop target. Both handlers would write
        // back the whole arrangement from their own render, and the group's, landing second,
        // would undo this drop. The row already files the folder into the right group.
        e.stopPropagation()
        onReorderFolder(dragged, node.path)
      }}
      onContextMenu={(e) => {
        card.hideNow()
        if (folderMenu === undefined) return
        e.preventDefault()
        folderMenu(node.path, e.clientX, e.clientY, depth !== 0)
      }}
    >
      {card.anchor !== null && (
        <FolderHoverCard node={node} anchor={card.anchor} keepOpen={card.keepOpen} scheduleClose={card.scheduleClose} />
      )}
      <FolderRowControls
        node={node} isOpen={isOpen} isGit={isGit} onToggle={onToggle} onNewSession={onNewSession}
        onNewWorktree={onNewWorktree} onCollapseBeneath={onCollapseBeneath}
      />
    </div>
  )
}
