import { CloseIcon } from './icons'

export interface SessionTabView {
  key: string
  label: string
  /** A session started from "+" that hasn't produced its JSONL yet, shown the way the sidebar
   *  shows it so the two agree while it resolves. */
  isPending: boolean
}

interface Props {
  tabs: SessionTabView[]
  activeKey: string | null
  onActivate: (key: string) => void
  onClose: (key: string) => void
}

/**
 * One column's strip of open sessions. Purely presentational — which sessions are open, and which
 * is active, is the column model's business (see state/columns.ts).
 *
 * The close button is a sibling of the tab button rather than nested inside it: a <button> cannot
 * contain another interactive element, the same constraint the sidebar rows work around.
 */
export function SessionTabBar({ tabs, activeKey, onActivate, onClose }: Props): JSX.Element {
  return (
    <div className="session-tab-bar" data-testid="session-tab-bar" role="tablist">
      {tabs.map((tab) => (
        <div
          key={tab.key}
          className="session-tab"
          data-testid="session-tab"
          data-active={tab.key === activeKey}
        >
          <button
            className="session-tab-label"
            data-testid="session-tab-label"
            role="tab"
            aria-selected={tab.key === activeKey}
            title={tab.label}
            onClick={() => onActivate(tab.key)}
          >
            {tab.isPending && <span className="live-dot" aria-label="running" />}
            <span className="session-tab-text">{tab.label}</span>
          </button>
          <button
            className="session-tab-close"
            data-testid="session-tab-close"
            title="Close session"
            aria-label="Close session"
            onClick={() => onClose(tab.key)}
          >
            <CloseIcon />
          </button>
        </div>
      ))}
    </div>
  )
}
