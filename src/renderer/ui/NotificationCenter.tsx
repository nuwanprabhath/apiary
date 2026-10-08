import { type JSX, useState } from 'react'
import { useNotifications, useNotificationItems } from './notifications'
import { CloseIcon, NotificationKindIcon } from './icons'
import { copyText } from '../state/clipboard'

/**
 * The stack of live notifications, bottom-right, over everything else.
 *
 * Rendered once at the root rather than per pane: a failure raised by a column the user has since
 * navigated away from still needs to reach them, and a message that moves around the screen
 * depending on which pane raised it is harder to find than one that always appears in the same
 * corner. `aria-live="polite"` lets a screen reader announce each one without stealing focus.
 */
export function NotificationCenter(): JSX.Element | null {
  const { dismiss } = useNotifications()
  const items = useNotificationItems()
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())

  if (items.length === 0) return null

  const toggleDetail = (id: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="notification-stack" data-testid="notification-stack" aria-live="polite">
      {items.map((n) => (
        <div key={n.id} className="notification" data-kind={n.kind} data-testid="notification" role={n.kind === 'error' ? 'alert' : 'status'}>
          <span className="notification-icon" data-testid="notification-icon"><NotificationKindIcon kind={n.kind} /></span>
          <div className="notification-body">
            <p className="notification-message" data-testid="notification-message">{n.message}</p>
            {n.detail !== null && expanded.has(n.id) && (
              <pre className="notification-detail" data-testid="notification-detail">{n.detail}</pre>
            )}
            {(n.action !== null || n.detail !== null) && (
              <div className="notification-actions">
                {n.action !== null && (
                  <button
                    className="btn small"
                    data-testid="notification-action"
                    onClick={() => { n.action?.run(); dismiss(n.id) }}
                  >
                    {n.action.label}
                  </button>
                )}
                {n.detail !== null && (
                  <>
                    <button
                      className="btn small"
                      data-testid="notification-detail-toggle"
                      aria-expanded={expanded.has(n.id)}
                      onClick={() => toggleDetail(n.id)}
                    >
                      {expanded.has(n.id) ? 'Hide details' : 'Details'}
                    </button>
                    <button
                      className="btn small"
                      data-testid="notification-copy"
                      onClick={() => { void copyText(`${n.message}\n\n${n.detail ?? ''}`) }}
                    >
                      Copy
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
          <button
            className="notification-close"
            data-testid="notification-close"
            title="Dismiss"
            aria-label="Dismiss notification"
            onClick={() => dismiss(n.id)}
          >
            <CloseIcon />
          </button>
        </div>
      ))}
    </div>
  )
}
