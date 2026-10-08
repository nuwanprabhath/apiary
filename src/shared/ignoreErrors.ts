/**
 * The one place a thrown error is deliberately thrown away. `apiary/no-silent-catch` forbids an
 * empty `catch` / `.catch(() => {})` everywhere else, because a swallowed error is how a failure
 * goes unnoticed; this is for the calls where failing is expected and harmless: a process that
 * exited between two calls, a file that may be gone, a line of JSON that may be truncated.
 *
 * `why` is documentation the compiler insists on: say what failing means, so the next reader can
 * tell a deliberate swallow from a forgotten one. If a failure should be seen, do not use this:
 * log it (`fireAndForget(promise, scope)`, `log.warn(scope, ...)`) or show it.
 *
 * Returns `undefined` when `fn` threw. Never logs, so it is safe where logging is the thing that
 * failed (`src/main/log/logger.ts`).
 */
export function ignoreErrors<T>(fn: () => T, _why: string): T | undefined {
  try {
    return fn()
  } catch {
    return undefined
  }
}

/** `ignoreErrors` for an async call: `undefined` when it rejected. */
export async function ignoreErrorsAsync<T>(fn: () => Promise<T>, _why: string): Promise<T | undefined> {
  try {
    return await fn()
  } catch {
    return undefined
  }
}
