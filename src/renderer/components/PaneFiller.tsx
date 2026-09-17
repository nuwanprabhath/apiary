import { useEffect, useMemo, useState } from 'react'
import type { ProjectNode, SessionNode } from '@shared/types'
import { relativeTime } from './SessionRow'

const RECENT = 8

function flatten(nodes: ProjectNode[], into: SessionNode[] = []): SessionNode[] {
  for (const node of nodes) {
    into.push(...node.sessions)
    flatten(node.children, into)
  }
  return into
}

interface Props {
  /** Tabs open in the window's other panes. */
  openTabs: { key: string; label: string }[]
  /** Session ids already open anywhere in the window — not offered as sessions to open. */
  exclude: Set<string>
  onMoveHere: (key: string) => void
  onOpenHere: (session: SessionNode) => void
  onClosePane: () => void
}

/**
 * What a pane shows while it is a zone waiting to be filled — Windows' Snap Assist, inside the
 * pane: what is already open elsewhere first, since moving is the common case, then recent
 * sessions. Ignoring it is fine; closing it steps the layout down.
 */
export function PaneFiller({ openTabs, exclude, onMoveHere, onOpenHere, onClosePane }: Props): JSX.Element {
  const [sessions, setSessions] = useState<SessionNode[]>([])
  const [query, setQuery] = useState('')

  useEffect(() => {
    let cancelled = false
    void window.apiary.tree('')
      .then((nodes) => { if (!cancelled) setSessions(flatten(nodes)) })
      .catch(() => { /* the open tabs are still offered; recent sessions are a convenience */ })
    return () => { cancelled = true }
  }, [])

  const needle = query.trim().toLowerCase()
  const matches = (title: string): boolean => needle === '' || title.toLowerCase().includes(needle)
  const tabs = openTabs.filter((t) => matches(t.label))
  const sorted = useMemo(() => sessions
    .filter((s) => !exclude.has(s.sessionId))
    .sort((a, b) => (b.lastActiveAtMs ?? 0) - (a.lastActiveAtMs ?? 0)), [sessions, exclude])
  const recent = sorted.filter((s) => matches(s.title)).slice(0, RECENT)

  return (
    <div className="pane-filler" data-testid="pane-filler">
      <input
        className="search"
        data-testid="pane-filler-search"
        placeholder="Find a session for this pane"
        value={query}
        onChange={(e) => { setQuery(e.target.value) }}
      />
      {tabs.length > 0 && (
        <section>
          <h2 className="pane-filler-heading">Open in this window</h2>
          {tabs.map((t) => (
            <button key={t.key} className="session-row" data-testid="pane-filler-tab" onClick={() => { onMoveHere(t.key) }}>
              <span className="session-title">{t.label}</span>
            </button>
          ))}
        </section>
      )}
      {recent.length > 0 && (
        <section>
          <h2 className="pane-filler-heading">Recent sessions</h2>
          {recent.map((s) => (
            <button key={s.sessionId} className="session-row" data-testid="pane-filler-session" onClick={() => { onOpenHere(s) }}>
              <span className="session-title">{s.title}</span>
              <span className="session-time">{relativeTime(s.lastActiveAtMs)}</span>
            </button>
          ))}
        </section>
      )}
      {tabs.length === 0 && recent.length === 0 && <p className="empty">Nothing matches.</p>}
      <button className="btn small pane-filler-close" data-testid="pane-filler-close" onClick={onClosePane}>
        Close pane
      </button>
    </div>
  )
}
