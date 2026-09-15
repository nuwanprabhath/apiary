import type { ProjectNode, SessionNode } from '@shared/types'
import { SessionRow } from './SessionRow'

interface Props {
  nodes: ProjectNode[]
  depth?: number
  collapsed: Set<string>
  onToggle: (path: string) => void
  selectedId: string | null
  onSelect: (session: SessionNode) => void
  /** Starts a brand-new Claude Code session in this project's folder. */
  onNewSession: (path: string) => void
  /** Asks to remove a session from view (confirmation, if any, is the caller's concern). */
  onDeleteSession: (session: SessionNode) => void
  /** Opens the session in a column of its own beside the current one. */
  onSplitSession: (session: SessionNode) => void
  /** Session ids currently pinned. These are drawn in the sidebar's pinned section instead of
   *  here, so the same row is never listed twice. */
  pinned: Set<string>
  onTogglePin: (session: SessionNode) => void
  /** Opens the note editor for a session. */
  onEditNote: (session: SessionNode) => void
  /**
   * Drag-to-reorder, at every level. The worktrees under a repository are as much a list with an
   * order worth having as the top-level folders are — 1.0.11 before 1.0.12, or the other way
   * round, is the user's call. Ordering is stored by absolute path, which is unique across the
   * whole tree, so one list serves every level without them interfering.
   */
  onReorderFolder?: (path: string, beforePath: string) => void
  /** Filing into groups stays a top-level idea: a worktree belongs to its repository, not a group. */
  onFolderMenu?: (path: string, x: number, y: number) => void
  /** Right-click on a session row. */
  onSessionMenu?: (session: SessionNode, x: number, y: number) => void
  /** Orders a level's folders by the user's arrangement. */
  orderFolders?: (nodes: ProjectNode[]) => ProjectNode[]
}

export function SessionTree({
  nodes, depth = 0, collapsed, onToggle, selectedId, onSelect, onNewSession, onDeleteSession,
  onSplitSession, pinned, onTogglePin, onEditNote, onReorderFolder, onFolderMenu,
  onSessionMenu, orderFolders,
}: Props): JSX.Element {
  const rearrangeable = onReorderFolder !== undefined
  const ordered = orderFolders === undefined ? nodes : orderFolders(nodes)
  return (
    <ul className="tree" style={{ paddingLeft: depth === 0 ? 0 : 14 }}>
      {ordered.map((node) => {
        const isOpen = !collapsed.has(node.path)
        const childProjects = node.children
        // A folder whose every session is pinned still shows its header: it keeps its "+" button,
        // so starting a new session there is still one click, and the folder doesn't appear to
        // have vanished just because its contents were promoted to the top of the sidebar.
        const unpinned = node.sessions.filter((s) => !pinned.has(s.sessionId))
        return (
          <li key={node.path} data-testid="project-group">
            <div
              className="project-row-wrap"
              data-folder-path={node.path}
              // Depth is explicit because it decides what a folder can do: only the outermost
              // level can be filed into a group, and a CSS selector cannot tell the levels apart
              // without encoding the nesting of the markup into every query that asks.
              data-depth={depth}
              draggable={rearrangeable}
              onDragStart={(e) => {
                if (!rearrangeable) return
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('application/x-apiary-folder', node.path)
              }}
              onDragOver={(e) => {
                // Only react to a folder drag: without the type check this would also swallow a
                // tab being dragged across the window.
                if (!rearrangeable || !e.dataTransfer.types.includes('application/x-apiary-folder')) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
              }}
              onDrop={(e) => {
                if (!rearrangeable) return
                const dragged = e.dataTransfer.getData('application/x-apiary-folder')
                if (dragged === '' || dragged === node.path) return
                e.preventDefault()
                // A row inside a group sits inside the group's own drop target, which covers the
                // whole section. Both handlers would then fire and both would write back the
                // whole arrangement from the render they were created in — so the group's copy,
                // landing second, restored the order this drop had just changed. The row is the
                // more specific target and already files the folder into the right group itself,
                // so the drop stops here.
                e.stopPropagation()
                onReorderFolder(dragged, node.path)
              }}
              onContextMenu={(e) => {
                if (depth !== 0 || onFolderMenu === undefined) return
                e.preventDefault()
                onFolderMenu(node.path, e.clientX, e.clientY)
              }}
            >
              <button
                className="project-row"
                data-testid="project-toggle"
                onClick={() => onToggle(node.path)}
                aria-expanded={isOpen}
              >
                <svg
                  className="chevron"
                  data-expanded={isOpen}
                  viewBox="0 0 16 16"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  aria-hidden="true"
                >
                  <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="project-label">{node.label}</span>
                {node.branch !== null && <span className="branch">{node.branch}</span>}
              </button>
              <button
                className="new-session-button"
                data-testid="new-session-button"
                title={`New Claude Code session in ${node.label}`}
                aria-label={`New Claude Code session in ${node.label}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onNewSession(node.path)
                }}
              >
                <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <path d="M8 2.5v11M2.5 8h11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </button>
            </div>

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
                  />
                ))}
                {childProjects.length > 0 && (
                  <SessionTree
                    nodes={childProjects}
                    depth={depth + 1}
                    collapsed={collapsed}
                    onToggle={onToggle}
                    selectedId={selectedId}
                    onSelect={onSelect}
                    onNewSession={onNewSession}
                    onDeleteSession={onDeleteSession}
                    onSplitSession={onSplitSession}
                    pinned={pinned}
                    onTogglePin={onTogglePin}
                    onEditNote={onEditNote}
                    onReorderFolder={onReorderFolder}
                    onSessionMenu={onSessionMenu}
                    orderFolders={orderFolders}
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
