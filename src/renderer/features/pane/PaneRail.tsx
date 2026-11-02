import type { JSX } from 'react'
import { SidebarIcon } from '../../ui/icons'
import type { RailState } from '../../state/layout'
import type { SessionTabView } from './paneTypes'

/** Tabs a rail lists one by one; past this it says how many more there are. */
const RAIL_TABS = 10

/**
 * The tab bar's button that collapses a full-height pane sideways to a rail, beside the split
 * button. Refused (and says why) when this is the last open pane of its row.
 */
export function RailButton({ rail, onRail }: { rail: RailState; onRail?: (rail: boolean) => void }): JSX.Element | null {
  if (rail === 'none' || rail === 'rail') return null
  const refused = rail === 'last'
  return (
    <button
      type="button"
      className="icon-button quiet pane-rail-collapse"
      data-testid="pane-rail-collapse"
      aria-label="Collapse this pane"
      aria-disabled={refused}
      title={refused ? 'Collapse this pane — one pane in the row stays open' : 'Collapse this pane'}
      onClick={() => { if (!refused) onRail?.(true) }}
    >
      <SidebarIcon />
    </button>
  )
}

/**
 * What a pane collapsed sideways shows: a button that expands it, then one entry per tab (its
 * status, the title as a tooltip) that expands the pane onto that tab. Drawn inside the pane's card,
 * which wears the working / needs-you glow for the whole rail (SessionColumn).
 */
export function PaneRail({ tabs, activeKey, onExpand, onActivate }: {
  tabs: SessionTabView[]
  activeKey: string | null
  onExpand: () => void
  onActivate: (key: string) => void
}): JSX.Element {
  const shown = tabs.slice(0, RAIL_TABS)
  const more = tabs.length - shown.length
  return (
    <div className="pane-rail" data-testid="pane-rail">
      <button
        type="button"
        className="icon-button quiet pane-rail-expand"
        data-testid="pane-rail-expand"
        aria-label="Expand this pane"
        title="Expand this pane"
        onClick={onExpand}
      >
        <SidebarIcon />
      </button>
      {shown.map((tab) => (
        <button
          key={tab.key}
          type="button"
          className="icon-button quiet pane-rail-tab"
          data-testid="pane-rail-tab"
          data-key={tab.key}
          data-active={tab.key === activeKey}
          aria-label={tab.label}
          title={tab.label}
          onClick={() => { onActivate(tab.key); onExpand() }}
        >
          <span className="status-dot" data-status={tab.activity} />
        </button>
      ))}
      {more > 0 && (
        <button
          type="button"
          className="icon-button quiet pane-rail-more"
          data-testid="pane-rail-more"
          aria-label={`${String(tabs.length)} tabs — expand this pane`}
          title={`${String(tabs.length)} tabs`}
          onClick={onExpand}
        >
          +{more}
        </button>
      )}
    </div>
  )
}
