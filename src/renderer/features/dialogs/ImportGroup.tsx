import type { JSX } from 'react'
import type { DiscoveredSession } from '@shared/api'
import type { SessionId } from '@shared/domain/ids'
import { ChevronIcon } from '../../ui/icons/ChevronIcon'

/**
 * What the hover tooltip says about a row: its full title (the visible one is ellipsized to fit)
 * and how long ago it was last touched, in both the relative form you actually think in and the
 * absolute one you need when comparing two of them.
 */
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
  // "In" means the session will be in the sidebar once this dialog is confirmed —
  // whether it was already imported on a previous visit or has just been ticked here.
  // Counting only the freshly-ticked ones is what used to leave a folder whose every
  // session was already imported showing an *unchecked* header, which reads as "none of
  // this folder is imported" when in fact all of it is.
  const isIn = (s: DiscoveredSession): boolean => s.imported || picked.has(s.sessionId)
  const allPicked = sessions.length > 0 && sessions.every(isIn)
  // Some but not all: the header shows the tri-state dash rather than claiming either.
  const somePicked = !allPicked && sessions.some(isIn)
  return (
    <section data-testid="import-group">
      {/* The chevron is a sibling of the label rather than inside it: a <label> forwards
       *  every click within it to its own control, so a nested collapse button would
       *  toggle the folder's checkbox on the way past. Same reason the sidebar's row
       *  buttons sit beside their row rather than inside it. */}
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
            // `indeterminate` is a DOM property with no HTML attribute behind it, so it
            // can only be set through the element itself, not through JSX.
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
