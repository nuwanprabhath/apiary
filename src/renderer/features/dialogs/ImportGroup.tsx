import type { JSX } from 'react'
import type { DiscoveredSession } from '@shared/api'
import type { SessionId } from '@shared/domain/ids'
import { ChevronIcon } from '../../ui/icons/ChevronIcon'

/** The hover tooltip: the full title (the visible one is ellipsized) and the last activity, relative and absolute. */
function describeSession(s: DiscoveredSession): string {
  if (s.lastActiveAtMs === null) return s.title
  const when = new Date(s.lastActiveAtMs)
  const days = Math.floor((Date.now() - s.lastActiveAtMs) / 86400000)
  const ago = days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${String(days)} days ago`
  return `${s.title}\n\nLast active ${ago} — ${when.toLocaleString()}`
}

interface Props {
  path: string
  sessions: DiscoveredSession[]
  picked: Set<SessionId>
  collapsed: boolean
  onToggleCollapsed: () => void
  onToggleGroup: (on: boolean) => void
  onToggleSession: (id: SessionId) => void
}

/** One folder of the import list: a tri-state header and the sessions under it. */
export function ImportGroup(
  { path, sessions, picked, collapsed, onToggleCollapsed, onToggleGroup, onToggleSession }: Props,
): JSX.Element {
  const selectable = sessions.filter((s) => !s.imported)
  // "In" means in the sidebar once confirmed: already imported or just ticked. Counting only the
  // ticked would show an unchecked header for a folder that is fully imported.
  const isIn = (s: DiscoveredSession): boolean => s.imported || picked.has(s.sessionId)
  const allPicked = sessions.length > 0 && sessions.every(isIn)
  const somePicked = !allPicked && sessions.some(isIn)
  return (
    <section data-testid="import-group">
      {/* The chevron sits beside the label: a <label> forwards every click inside it to its checkbox. */}
      <div className="import-group-head">
        <button
          className="import-group-toggle"
          data-testid="import-group-toggle"
          aria-expanded={!collapsed}
          title={collapsed ? 'Expand folder' : 'Collapse folder'}
          onClick={onToggleCollapsed}
        >
          <ChevronIcon expanded={!collapsed} />
        </button>
        <label className="import-group-label">
          <input
            type="checkbox"
            data-testid="import-group-checkbox"
            checked={allPicked}
            // `indeterminate` has no HTML attribute, so it is set on the element.
            ref={(el) => { if (el !== null) el.indeterminate = somePicked }}
            disabled={selectable.length === 0}
            onChange={(e) => { onToggleGroup(e.target.checked) }}
          />
          <span className="project-label">{path}</span>
          <span className="muted">{sessions.length}</span>
        </label>
      </div>

      {!collapsed && sessions.map((s) => (
        <label key={s.sessionId} className="import-row" title={describeSession(s)}>
          <input
            type="checkbox"
            data-testid="import-session-checkbox"
            checked={s.imported || picked.has(s.sessionId)}
            disabled={s.imported}
            onChange={() => { onToggleSession(s.sessionId) }}
          />
          <span className="session-title">{s.title}</span>
          {s.imported && <span className="muted">already imported</span>}
        </label>
      ))}
    </section>
  )
}
