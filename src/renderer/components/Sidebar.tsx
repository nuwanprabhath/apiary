import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ProjectNode, SessionNode } from '@shared/types'
import { useTree } from '../state/useTree'
import { SessionTree } from './SessionTree'
import { SessionRow } from './SessionRow'
import { CloseIcon, RefreshIcon } from './icons'

/** Every session anywhere in the tree, flattened, so pinned ids can be resolved back to rows. */
function flattenSessions(nodes: ProjectNode[], into = new Map<string, SessionNode>()): Map<string, SessionNode> {
  for (const node of nodes) {
    for (const s of node.sessions) into.set(s.sessionId, s)
    flattenSessions(node.children, into)
  }
  return into
}

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
  /** Opens a session in a column of its own beside the current one. */
  onSplitSession: (session: SessionNode) => void
  /** Session ids the user has pinned, most recently pinned first. */
  pinned: string[]
  onTogglePin: (session: SessionNode) => void
  /** Whether the pinned section is collapsed — persisted, like the folder collapse state. */
  pinnedCollapsed: boolean
  onPinnedCollapsedChange: (next: boolean) => void
  /** New-session ptys not yet resolved into a real SessionNode, excluding whichever one (if any)
   * is already the one shown in the main pane — so this lists only the ones a click would
   * actually switch to. */
  pending: PendingSessionSummary[]
  /** Switches the main pane to a pending session's terminal. */
  onSelectPending: (ptyId: string) => void
  /**
   * A session to scroll into view, set when its tab is activated (Settings > Sidebar). Changing
   * this is the whole signal: it is deliberately not the same as `selectedId`, so that merely
   * re-rendering with a selection does not yank the list around while you are scrolling it by hand.
   */
  revealId: string | null
}

/**
 * The chain of folder paths leading to a session, outermost first.
 *
 * Revealing a session means nothing while the folder holding it is collapsed — the row does not
 * exist to scroll to. These are the folders that have to be opened for it to.
 */
function pathsToSession(nodes: ProjectNode[], id: string, trail: string[] = []): string[] | null {
  for (const node of nodes) {
    const here = [...trail, node.path]
    if (node.sessions.some((s) => s.sessionId === id)) return here
    const deeper = pathsToSession(node.children, id, here)
    if (deeper) return deeper
  }
  return null
}

export function Sidebar({
  selectedId, onSelect, collapsed, onCollapsedChange, onNewSession, onDeleteSession,
  onSplitSession, pinned, onTogglePin, pinnedCollapsed, onPinnedCollapsedChange,
  pending, onSelectPending, revealId,
}: Props): JSX.Element {
  const [query, setQuery] = useState('')
  const { tree, loading, reload } = useTree(query)
  const [refreshing, setRefreshing] = useState(false)
  const listRef = useRef<HTMLDivElement | null>(null)

  /**
   * Scrolls a revealed session's row into view, opening the folders above it first.
   *
   * Re-runs on tree and collapse changes as well as on `revealId`, because the row usually is not
   * rendered at the moment the reveal is asked for: the tree arrives asynchronously, and a folder
   * may need opening before the row exists at all. Each pass does the next thing it can and lets
   * the resulting render bring it back.
   *
   * `scrolledTo` is what stops it fighting the user: once a session has been scrolled to, later
   * renders leave the list alone, so a tree refresh while you are scrolling by hand does not yank
   * you back. `block: 'nearest'` likewise leaves an already-visible row exactly where it is.
   */
  const scrolledTo = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (revealId === null || scrolledTo.current === revealId) return

    const chain = pathsToSession(tree, revealId)
    if (chain !== null && chain.some((path) => collapsed.has(path))) {
      const next = new Set(collapsed)
      for (const path of chain) next.delete(path)
      onCollapsedChange(next)
      return
    }

    const row = listRef.current?.querySelector(`[data-session-id="${CSS.escape(revealId)}"]`)
    if (!row) return
    row.scrollIntoView({ block: 'nearest' })
    scrolledTo.current = revealId
  }, [revealId, tree, collapsed, onCollapsedChange])

  const isEmpty = useMemo(() => !loading && tree.length === 0, [loading, tree])

  /**
   * Pinned rows, in the order they were pinned rather than the order the tree happens to hold
   * them. Resolved against the *filtered* tree, so a search narrows the pinned section too —
   * a pinned session that doesn't match what you typed would otherwise be the one row on screen
   * that ignores the search box.
   */
  const pinnedSet = useMemo(() => new Set(pinned), [pinned])
  const pinnedSessions = useMemo(() => {
    const byId = flattenSessions(tree)
    return pinned.map((id) => byId.get(id)).filter((s): s is SessionNode => s !== undefined)
  }, [tree, pinned])

  const toggle = (path: string): void => {
    const next = new Set(collapsed)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    onCollapsedChange(next)
  }

  return (
    <aside className="sidebar" ref={listRef}>
      <div className="sidebar-header">
        {/* The clear button sits inside the field rather than beside it, so the row keeps the
         *  two-control shape it already had (field + Refresh) instead of gaining a third
         *  element that steals width from the field on a narrow sidebar. */}
        <div className="search-field">
          <input
            className="search"
            data-testid="search-input"
            placeholder="Search sessions"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query !== '' && (
            <button
              className="search-clear"
              data-testid="search-clear"
              title="Clear search"
              aria-label="Clear search"
              onClick={() => setQuery('')}
            >
              <CloseIcon />
            </button>
          )}
        </div>
        <button
          className="icon-button sidebar-refresh"
          data-testid="sidebar-refresh"
          data-refreshing={refreshing}
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
          {/* The icon spins in place while a refresh is in flight; the label never leaves, so the
           *  button's own width stays put instead of visibly collapsing to a bare glyph. */}
          <RefreshIcon className={refreshing ? 'spinner' : undefined} />
          <span>Refresh</span>
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

      {pinnedSessions.length > 0 && (
        <section className="pinned-section" data-testid="pinned-section">
          <button
            className="pinned-header"
            data-testid="pinned-toggle"
            aria-expanded={!pinnedCollapsed}
            onClick={() => onPinnedCollapsedChange(!pinnedCollapsed)}
          >
            <svg
              className="chevron"
              data-expanded={!pinnedCollapsed}
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="pinned-label">Pinned</span>
            <span className="pinned-count">{pinnedSessions.length}</span>
          </button>
          {!pinnedCollapsed && pinnedSessions.map((s) => (
            <SessionRow
              key={s.sessionId}
              session={s}
              selected={s.sessionId === selectedId}
              pinned
              onSelect={onSelect}
              onSplit={onSplitSession}
              onDelete={onDeleteSession}
              onTogglePin={onTogglePin}
            />
          ))}
        </section>
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
          onSplitSession={onSplitSession}
          pinned={pinnedSet}
          onTogglePin={onTogglePin}
        />
      )}
    </aside>
  )
}
