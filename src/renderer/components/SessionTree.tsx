import type { ProjectNode, SessionNode } from '@shared/types'

function relativeTime(ms: number | null): string {
  if (ms === null) return ''
  const days = Math.floor((Date.now() - ms) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return '1d'
  return String(days) + 'd'
}

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
}

export function SessionTree({
  nodes, depth = 0, collapsed, onToggle, selectedId, onSelect, onNewSession, onDeleteSession,
}: Props): JSX.Element {
  return (
    <ul className="tree" style={{ paddingLeft: depth === 0 ? 0 : 14 }}>
      {nodes.map((node) => {
        const isOpen = !collapsed.has(node.path)
        const childProjects = node.children
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
                {node.sessions.map((s) => (
                  // A <button> cannot nest another interactive element, so the delete button is
                  // a sibling here — the same wrapper pattern .project-row-wrap uses above for
                  // its own "+" button.
                  <div key={s.sessionId} className="session-row-wrap">
                    <button
                      className="session-row"
                      data-testid="session-item"
                      data-selected={s.sessionId === selectedId}
                      data-live={s.isLive}
                      onClick={() => onSelect(s)}
                      title={s.cwd}
                    >
                      {s.isLive && <span className="live-dot" aria-label="running" />}
                      <span className="session-title">{s.title}</span>
                      {!s.cwdExists && <span className="missing">folder gone</span>}
                      <span className="session-time">{relativeTime(s.lastActiveAtMs)}</span>
                    </button>
                    <button
                      className="delete-session-button"
                      data-testid="delete-session-button"
                      title="Remove this session"
                      aria-label={`Remove session ${s.title}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        onDeleteSession(s)
                      }}
                    >
                      <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                        <path
                          d="M3.5 4.5h9M6.5 4.5V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.5M6 7v4.5M10 7v4.5M4.5 4.5l.6 8.1a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8.1"
                          stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                  </div>
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
