import type { LogScope } from '@shared/domain/log'
import { errorMessage } from '@shared/errors'
import { logLine } from '../state/log'

/**
 * Runs a background task without waiting on it, but never silently: the renderer's counterpart to
 * main's `src/main/log/fireAndForget.ts`. A rejection goes to the diagnostic log instead of
 * becoming an unhandled rejection.
 *
 * For a click handler whose effect already tells the user it worked, so a failure is logged, not
 * toasted. When a failure should interrupt them, call `notifyError` instead.
 */
export function fireAndForget(promise: Promise<unknown>, scope: LogScope): void {
  promise.catch((error: unknown) => { logBackgroundFailure(error, scope) })
}

/** Writes one background failure to the diagnostic log — what `fireAndForget` does on a rejection,
 *  for the code (a store's refetch) that already holds the error. */
export function logBackgroundFailure(error: unknown, scope: LogScope): void {
  logLine('warn', scope, 'background task failed', { error: errorMessage(error) })
}
