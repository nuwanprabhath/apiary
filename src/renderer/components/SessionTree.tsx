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
}

export function SessionTree({
  nodes, depth = 0, collapsed, onToggle, selectedId, onSelect, onNewSession, onDeleteSession,
  onSplitSession, pinned, onTogglePin,
}: Props): JSX.Element {
  return (
    <ul className="tree" style={{ paddingLeft: depth === 0 ? 0 : 14 }}>
      {nodes.map((node) => {
        const isOpen = !collapsed.has(node.path)
        const childProjects = node.children
        // A folder whose every session is pinned still shows its header: it keeps its "+" button,
        // so starting a new session there is still one click, and the folder doesn't appear to
        // have vanished just because its contents were promoted to the top of the sidebar.
        const unpinned = node.sessions.filter((s) => !pinned.has(s.sessionId))
        return (
          <li key={node.path} data-testid="project-group">
            <div className="project-row-wrap">
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
