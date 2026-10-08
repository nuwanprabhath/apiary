import type { LogScope } from '@shared/domain/log'
import { fireAndForget, logBackgroundFailure } from '../ui/fireAndForget'

/**
 * The renderer's one error policy for commands sent to main. A command in `state/` is exactly one
 * of these, and a component never holds a raw bridge promise it has not been handed on purpose:
 *
 * 1. **Background** — `background(promise, scope)`. Nothing the user asked for failed; the effect
 *    (or its absence) is the feedback. The failure goes to the diagnostic log. Also what a
 *    best-effort call is: if failing is harmless, it is still logged, never swallowed.
 * 2. **Surfaced** — `surface(promise, 'Could not …')` (or `attempt`, which says whether it worked). The user asked for it and would otherwise
 *    not know it failed: a toast through the notification centre, once, with the detail one click
 *    away. The returned promise never rejects, so the caller has nothing to catch.
 * 3. **Returned** — the command hands back its promise. For a component that waits for the answer
 *    anyway (a busy spinner, a dialog with an inline error line, a result it renders); it catches
 *    with `describeError`. Those are plain exports, with no wrapper.
 *
 * A bare `.catch(() => {})` or `void window.apiary.x()` is none of these, and the lint rules
 * (`no-silent-catch`, `no-void-bridge-call`) say so.
 */

/** What `NotificationProvider` registers: `notifyError` of the live provider. */
type FailureSink = (thrown: unknown, context?: string) => void

let sink: FailureSink | null = null

/** Wired by `NotificationProvider` for as long as it is mounted. */
export function setFailureSink(next: FailureSink | null): void {
  sink = next
}

/** Shows one failure to the user — or, when no notification centre is mounted (a window still
 *  starting, a bare component), writes it to the diagnostic log so it is still findable. */
export function reportFailure(thrown: unknown, context: string): void {
  if (sink !== null) sink(thrown, context)
  else logBackgroundFailure(thrown, 'app')
}

/** Policy 2: tell the user if it failed, and resolve to whether it succeeded so a caller can
 *  follow up (a "Copied" tick) without a catch of its own. Never rejects. */
export async function attempt(promise: Promise<unknown>, context: string): Promise<boolean> {
  try {
    await promise
    return true
  } catch (thrown) {
    reportFailure(thrown, context)
    return false
  }
}

/** Policy 2 when nothing follows: start it and move on. */
export function surface(promise: Promise<unknown>, context: string): void {
  void attempt(promise, context)
}

/** Policy 1: logged, never shown. */
export function background(promise: Promise<unknown>, scope: LogScope): void {
  fireAndForget(promise, scope)
}

/** Policy 1 when the answer is wanted if it comes: the value, or null after logging the failure.
 *  For a read or a nudge whose failure just leaves things as they were. */
export async function bestEffort<T>(promise: Promise<T>, scope: LogScope): Promise<T | null> {
  try {
    return await promise
  } catch (thrown) {
    logBackgroundFailure(thrown, scope)
    return null
  }
}
