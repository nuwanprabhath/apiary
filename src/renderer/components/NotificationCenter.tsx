import { useState } from 'react'
import { useNotifications, type NotificationKind } from '../state/notifications'
import { CloseIcon } from './icons'

/**
 * A single glyph per kind, so the strip is legible at a glance without reading it — and so a
 * screenshot of a failure says "error" even in greyscale, which colour alone would not.
 */
function KindIcon({ kind }: { kind: NotificationKind }): JSX.Element {
  const common = { viewBox: '0 0 16 16', fill: 'none', xmlns: 'http://www.w3.org/2000/svg', 'aria-hidden': true } as const
  if (kind === 'error') {
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.3" />
        <path d="M8 4.8v4M8 11.1v.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    )
  }
  if (kind === 'warning') {
    return (
      <svg {...common}>
        <path d="M8 2.2 14.4 13H1.6L8 2.2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        <path d="M8 6.4v3M8 11.2v.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    )
  }
  if (kind === 'success') {
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.3" />
        <path d="m5.3 8.2 1.9 1.9 3.5-3.9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  return (
    <svg {...common}>
      <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 7.2v4M8 4.7v.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

/**
 * The stack of live notifications, bottom-right, over everything else.
 *
 * Rendered once at the root rather than per pane: a failure raised by a column the user has since
 * navigated away from still needs to reach them, and a message that moves around the screen
 * depending on which pane raised it is harder to find than one that always appears in the same
 * corner. `aria-live="polite"` lets a screen reader announce each one without stealing focus.
 */
export function NotificationCenter(): JSX.Element | null {
  const { items, dismiss } = useNotifications()
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
          <span className="notification-icon" data-testid="notification-icon"><KindIcon kind={n.kind} /></span>
          <div className="notification-body">
            <p className="notification-message" data-testid="notification-message">{n.message}</p>
            {n.detail !== null && expanded.has(n.id) && (
              <pre className="notification-detail" data-testid="notification-detail">{n.detail}</pre>
            )}
            {(n.action !== null || n.detail !== null) && (
              <div className="notification-actions">
                {n.action !== null && (
                  <button
                    className="notification-action"
                    data-testid="notification-action"
                    onClick={() => { n.action?.run(); dismiss(n.id) }}
                  >
                    {n.action.label}
                  </button>
                )}
                {n.detail !== null && (
                  <>
                    <button
                      className="notification-action"
                      data-testid="notification-detail-toggle"
                      aria-expanded={expanded.has(n.id)}
                      onClick={() => toggleDetail(n.id)}
                    >
                      {expanded.has(n.id) ? 'Hide details' : 'Details'}
                    </button>
                    <button
                      className="notification-action"
                      data-testid="notification-copy"
                      onClick={() => { void window.apiary.copyToClipboard(`${n.message}\n\n${n.detail ?? ''}`) }}
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
