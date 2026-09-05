import { useMemo, useState } from 'react'
import type { SessionNode } from '@shared/types'
import { useTree } from '../state/useTree'
import { SessionTree } from './SessionTree'

/** A new-session pty still awaiting its first JSONL — see `PendingSession` in App.tsx. Listed so
 *  a pending session other than the one currently shown can still be reached and switched back to,
 *  rather than being silently unreachable while it resolves in the background. */
export interface PendingSessionSummary {
  ptyId: string
  label: string
  cwd: string
}

interface Props {
  selectedId: string | null
  onSelect: (session: SessionNode) => void
  /** Paths of folders currently collapsed. Anything not in this set is open, including a
   * folder that has never been seen before — so new folders open by default without any
   * separate "seen before" tracking. */
  collapsed: Set<string>
  onCollapsedChange: (next: Set<string>) => void
  /** Starts a brand-new Claude Code session in a project's folder. */
  onNewSession: (path: string) => void
  /** Asks to remove a session from view. */
  onDeleteSession: (session: SessionNode) => void
  /** New-session ptys not yet resolved into a real SessionNode, excluding whichever one (if any)
   * is already the one shown in the main pane — so this lists only the ones a click would
   * actually switch to. */
  pending: PendingSessionSummary[]
  /** Switches the main pane to a pending session's terminal. */
  onSelectPending: (ptyId: string) => void
}

export function Sidebar({
  selectedId, onSelect, collapsed, onCollapsedChange, onNewSession, onDeleteSession,
  pending, onSelectPending,
}: Props): JSX.Element {
  const [query, setQuery] = useState('')
  const { tree, loading, reload } = useTree(query)
  const [refreshing, setRefreshing] = useState(false)

  const isEmpty = useMemo(() => !loading && tree.length === 0, [loading, tree])

  const toggle = (path: string): void => {
    const next = new Set(collapsed)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    onCollapsedChange(next)
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <input
          className="search"
          data-testid="search-input"
          placeholder="Search sessions"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          className="icon-button"
          data-testid="sidebar-refresh"
          disabled={refreshing}
          onClick={() => {
            setRefreshing(true)
            void window.apiary.refresh()
              .then(reload)
              .catch(() => reload())
              .finally(() => setRefreshing(false))
          }}
          title="Refresh"
        >
          {refreshing ? <span className="spinner" aria-hidden="true">⟳</span> : 'Refresh'}
        </button>
      </div>

      {isEmpty && query.trim() === '' && (
        <p className="empty" data-testid="sidebar-empty">
          No sessions imported yet.
          <br />
          Use <strong>File &gt; Import Claude Sessions</strong> to choose which ones to show.
          <br />
          <span className="muted">
            Apiary reads ~/.claude/projects, or CLAUDE_CONFIG_DIR when that is set.
          </span>
        </p>
      )}

      {isEmpty && query.trim() !== '' && (
        <p className="empty" data-testid="sidebar-no-matches">No sessions match that search.</p>
      )}

      {pending.length > 0 && (
        <ul className="pending-list" data-testid="pending-list">
          {pending.map((p) => (
            <li key={p.ptyId}>
              <button
                className="session-row pending-row"
                data-testid="pending-session-item"
                onClick={() => onSelectPending(p.ptyId)}
                title={p.cwd}
              >
                <span className="live-dot" aria-label="running" />
                <span className="session-title">New session &middot; {p.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {tree.length > 0 && (
        <SessionTree
          nodes={tree}
          collapsed={collapsed}
          onToggle={toggle}
          selectedId={selectedId}
          onSelect={onSelect}
          onNewSession={onNewSession}
          onDeleteSession={onDeleteSession}
        />
      )}
    </aside>
  )
}
