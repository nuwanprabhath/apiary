import type { LogScope } from '@shared/domain/log'

/**
 * Runs a background task without waiting on it, but never silently (UI-23) — the renderer's
 * counterpart to main's `src/main/log/fireAndForget.ts`. A rejection is written to the diagnostic
 * log through the same `logWrite` channel the window-level safety net in `state/notifications.tsx`
 * uses for whatever nothing else caught, instead of becoming an unhandled rejection whose only
 * trace is a devtools console nobody has open.
 *
 * Use this for a click handler that starts something and does not wait to see it finish — the
 * effect (a status broadcast, a menu closing) is what tells the user it worked, so a failure here
 * is not worth interrupting them with a toast for, but is still worth being able to find later.
 * When a failure *should* interrupt them, call `notifyError` instead: this is for the other case.
 */
export function fireAndForget(promise: Promise<unknown>, scope: LogScope): void {
  promise.catch((error: unknown) => {
    void window.apiary.logWrite('warn', scope, 'background task failed', {
      error: error instanceof Error ? error.message : String(error),
    })
  })
}
