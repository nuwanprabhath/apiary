import { type JSX, createContext, useCallback, use, useEffect, useMemo, useRef, useState } from 'react'
import { describeError } from './errors'
import { errorMessage } from '@shared/errors'
import { logLine } from '../state/log'
import { setFailureSink } from '../state/policy'

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

interface NotifyInput {
  kind?: NotificationKind
  message: string
  detail?: string | null
  action?: { label: string; run: () => void } | null
  /** Overrides the default dwell time. `null` pins it open until dismissed. */
  timeoutMs?: number | null
}

/** Errors are pinned until acknowledged: one the user blinked past is the failure this system exists to fix. */
const DEFAULT_TIMEOUT_MS: Record<NotificationKind, number | null> = {
  error: null,
  warning: 12000,
  info: 6000,
  success: 4000,
}

const MAX_VISIBLE = 4

interface NotificationsApi {
  notify: (input: NotifyInput) => string
  /** Shorthand for the overwhelmingly common case: something threw, tell the user what. */
  notifyError: (thrown: unknown, context?: string) => string
  dismiss: (id: string) => void
  dismissAll: () => void
}

const NotificationsContext = createContext<NotificationsApi | null>(null)

// Split from NotificationsApi: `items` changes on every toast shown or auto-dismissed, and only
// NotificationCenter reads it. The actions object stays stable across toasts.
const NotificationItemsContext = createContext<Notification[] | null>(null)

/**
 * The app's single channel for anything the user needs told. Also subscribes to `error` and
 * `unhandledrejection`, so an uncaught rejection surfaces. A crash during render is ErrorBoundary's.
 */
export function NotificationProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [items, setItems] = useState<Notification[]>([])
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
      // Live-refresh loops can fire the same failure several times a second.
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

  // What `state/` commands report a user-visible failure through (policy 2 in `state/policy.ts`).
  useEffect(() => {
    setFailureSink(notifyError)
    return () => { setFailureSink(null) }
  }, [notifyError])

  useEffect(() => () => {
    for (const timer of timers.current.values()) clearTimeout(timer)
    timers.current.clear()
  }, [])

  useEffect(() => {
    // Also written to the diagnostic log, when it is on. An error that reached this net is one
    // nothing else expected, which makes it the most valuable line in the file — and the toast
    // that shows it is gone in a few seconds, long before anyone thinks to write it down.
    const onError = (e: ErrorEvent): void => {
      logLine('error', 'window', 'uncaught error', {
        message: e.message,
        source: e.filename,
        line: e.lineno,
      })
      notifyError(e.error ?? e.message, 'Unexpected error')
    }
    const onRejection = (e: PromiseRejectionEvent): void => {
      logLine('error', 'window', 'unhandled rejection', {
        reason: errorMessage(e.reason),
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
    () => ({ notify, notifyError, dismiss, dismissAll }),
    [notify, notifyError, dismiss, dismissAll],
  )

  return (
    <NotificationsContext value={api}>
      <NotificationItemsContext value={items}>{children}</NotificationItemsContext>
    </NotificationsContext>
  )
}

export function useNotifications(): NotificationsApi {
  const api = use(NotificationsContext)
  if (api === null) throw new Error('useNotifications must be used inside a NotificationProvider')
  return api
}

/** The live toast list — only `NotificationCenter` needs this, and only it should re-render on it. */
export function useNotificationItems(): Notification[] {
  const items = use(NotificationItemsContext)
  if (items === null) throw new Error('useNotificationItems must be used inside a NotificationProvider')
  return items
}
