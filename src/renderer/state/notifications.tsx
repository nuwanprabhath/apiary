import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { describeError } from '../errors'

export type NotificationKind = 'error' | 'warning' | 'info' | 'success'

export interface Notification {
  id: string
  kind: NotificationKind
  /** The headline. One short sentence — what happened, in the user's terms. */
  message: string
  /** Optional technical text (a stack, a raw fs path) shown only when the user expands it. */
  detail: string | null
  /** Optional single action, e.g. "Reload". */
  action: { label: string; run: () => void } | null
}

export interface NotifyInput {
  kind?: NotificationKind
  message: string
  detail?: string | null
  action?: { label: string; run: () => void } | null
  /** Overrides the default dwell time. `null` pins it open until dismissed. */
  timeoutMs?: number | null
}

/**
 * How long each kind stays up before dismissing itself. Errors never do: an error the user
 * blinked past is exactly the failure mode this whole system exists to fix, so they are pinned
 * until acknowledged. Warnings linger longer than the merely informational.
 */
const DEFAULT_TIMEOUT_MS: Record<NotificationKind, number | null> = {
  error: null,
  warning: 12000,
  info: 6000,
  success: 4000,
}

/** At most this many at once; the oldest fall off the top rather than filling the window. */
const MAX_VISIBLE = 4

interface NotificationsApi {
  notify: (input: NotifyInput) => string
  /** Shorthand for the overwhelmingly common case: something threw, tell the user what. */
  notifyError: (thrown: unknown, context?: string) => string
  dismiss: (id: string) => void
  dismissAll: () => void
  items: Notification[]
}

const NotificationsContext = createContext<NotificationsApi | null>(null)

/**
 * The app's single channel for anything the user needs told: failures, warnings, confirmations.
 *
 * Also the safety net of last resort — it subscribes to `error` and `unhandledrejection` on the
 * window, so a rejected promise nobody caught surfaces as a message instead of only ever
 * appearing in a devtools console the user never opens. (A crash *during render* is the error
 * boundary's job, not this one's; see ErrorBoundary.tsx.)
 */
export function NotificationProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [items, setItems] = useState<Notification[]>([])
  // Timers are keyed by notification id so dismissing early can cancel the pending auto-dismiss
  // rather than leaving it to fire against an id that no longer exists.
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id)
    if (timer !== undefined) { clearTimeout(timer); timers.current.delete(id) }
    setItems((prev) => prev.filter((n) => n.id !== id))
  }, [])

  const dismissAll = useCallback(() => {
    for (const timer of timers.current.values()) clearTimeout(timer)
    timers.current.clear()
    setItems([])
  }, [])

  const notify = useCallback((input: NotifyInput): string => {
    const kind = input.kind ?? 'info'
    const id = `n${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`
    const next: Notification = {
      id,
      kind,
      message: input.message,
      detail: input.detail ?? null,
      action: input.action ?? null,
    }
    setItems((prev) => {
      // An identical message already on screen is repeated noise, not new information — the
      // live-refresh loops in this app can fire the same failure several times a second.
      const deduped = prev.filter((n) => !(n.kind === next.kind && n.message === next.message))
      return [...deduped, next].slice(-MAX_VISIBLE)
    })
    const timeout = input.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS[kind] : input.timeoutMs
    if (timeout !== null) {
      timers.current.set(id, setTimeout(() => { dismiss(id) }, timeout))
    }
    return id
  }, [dismiss])

  const notifyError = useCallback((thrown: unknown, context?: string): string => {
    const { message, detail } = describeError(thrown)
    return notify({
      kind: 'error',
      message: context === undefined ? message : `${context}: ${message}`,
      detail,
    })
  }, [notify])

  useEffect(() => () => {
    for (const timer of timers.current.values()) clearTimeout(timer)
    timers.current.clear()
  }, [])

  useEffect(() => {
    // Also written to the diagnostic log, when it is on. An error that reached this net is one
    // nothing else expected, which makes it the most valuable line in the file — and the toast
    // that shows it is gone in a few seconds, long before anyone thinks to write it down.
    const onError = (e: ErrorEvent): void => {
      window.apiary.logWrite('error', 'window', 'uncaught error', {
        message: e.message,
        source: e.filename,
        line: e.lineno,
      })
      notifyError(e.error ?? e.message, 'Unexpected error')
    }
    const onRejection = (e: PromiseRejectionEvent): void => {
      window.apiary.logWrite('error', 'window', 'unhandled rejection', {
        reason: e.reason instanceof Error ? e.reason.message : String(e.reason),
      })
      notifyError(e.reason, 'Unexpected error')
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [notifyError])

  const api = useMemo<NotificationsApi>(
    () => ({ notify, notifyError, dismiss, dismissAll, items }),
    [notify, notifyError, dismiss, dismissAll, items],
  )

  return <NotificationsContext.Provider value={api}>{children}</NotificationsContext.Provider>
}

export function useNotifications(): NotificationsApi {
  const api = useContext(NotificationsContext)
  if (api === null) throw new Error('useNotifications must be used inside a NotificationProvider')
  return api
}
