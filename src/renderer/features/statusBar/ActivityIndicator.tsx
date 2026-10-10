import { type JSX, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertIcon, CheckIcon, RefreshIcon } from '../../ui/icons'
import { type Activity, useActivities } from '../../state/activityStore'
import { reportFailure } from '../../state/policy'

function StateIcon({ activity }: { activity: Activity }): JSX.Element {
  if (activity.state === 'running') return <RefreshIcon className="spinner" />
  if (activity.state === 'done') return <CheckIcon className="activity-ok" />
  return <AlertIcon className="activity-failed" />
}

/** The headline: the newest running activity, else the newest of all. */
function headlineActivity(all: readonly Activity[]): Activity {
  const running = all.filter((a) => a.state === 'running')
  const pool = running.length > 0 ? running : all
  return pool[pool.length - 1]
}

/**
 * What the app is doing, at the left of the status bar. Knows nothing about what: it shows the
 * message of each activity in `activityStore`. A failed one is a button that shows its error again.
 */
export function ActivityIndicator(): JSX.Element | null {
  const all = useActivities()
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  if (all.length === 0) return null
  const main = headlineActivity(all)
  const more = all.length - 1
  const content = (
    <>
      <StateIcon activity={main} />
      <span className="activity-text">{main.message}</span>
      {more > 0 && <span className="activity-more">+{more}</span>}
    </>
  )
  const common = {
    className: 'activity-indicator',
    'data-testid': 'activity-indicator',
    'data-state': main.state,
    title: main.message,
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => { if (more > 0) setAnchor(e.currentTarget.getBoundingClientRect()) },
    onMouseLeave: () => { setAnchor(null) },
  }
  return (
    <>
      <div className="activity-region" role="status" aria-live="polite">
        {main.state === 'failed' ? (
          <button type="button" {...common} onClick={() => { reportFailure(main.error, main.message) }}>{content}</button>
        ) : (
          <div {...common}>{content}</div>
        )}
      </div>
      {anchor !== null && more > 0 && createPortal(
        <div
          className="status-hover"
          data-testid="activity-hover"
          role="tooltip"
          style={{ left: Math.max(8, anchor.left), bottom: window.innerHeight - anchor.top + 6 }}
        >
          <ul className="activity-list">
            {[...all].reverse().map((a) => (
              <li key={a.id} className="activity-row" data-state={a.state}>
                <StateIcon activity={a} />
                <span>{a.message}</span>
              </li>
            ))}
          </ul>
        </div>,
        document.body,
      )}
    </>
  )
}
