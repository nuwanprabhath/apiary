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

type FailureSink = (thrown: unknown, context?: string) => void

let sink: FailureSink | null = null

export function setFailureSink(next: FailureSink | null): void {
  sink = next
}

/** With no notification centre mounted (a window still starting), writes to the diagnostic log instead. */
export function reportFailure(thrown: unknown, context: string): void {
  if (sink !== null) sink(thrown, context)
  else logBackgroundFailure(thrown, 'app')
}

/** Policy 2; resolves to whether it succeeded, never rejects. */
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

/** Policy 1 returning the value, or null after logging the failure. */
export async function bestEffort<T>(promise: Promise<T>, scope: LogScope): Promise<T | null> {
  try {
    return await promise
  } catch (thrown) {
    logBackgroundFailure(thrown, scope)
    return null
  }
}
