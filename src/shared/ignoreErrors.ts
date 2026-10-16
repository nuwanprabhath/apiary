/**
 * The one place a thrown error is deliberately thrown away. `apiary/no-silent-catch` forbids an
 * empty `catch` / `.catch(() => {})` everywhere else, because a swallowed error is how a failure
 * goes unnoticed; this is for the calls where failing is expected and harmless: a process that
 * exited between two calls, a file that may be gone, a line of JSON that may be truncated.
 *
 * `why` says what failing means, so a deliberate swallow reads differently from a forgotten one.
 * If a failure should be seen, log it (`fireAndForget(promise, scope)`, `log.warn(scope, ...)`).
 *
 * Returns `undefined` when `fn` threw. Never logs, so it is safe where logging is what failed.
 */
export function ignoreErrors<T>(fn: () => T, _why: string): T | undefined {
  try {
    return fn()
  } catch {
    return undefined
  }
}

export async function ignoreErrorsAsync<T>(fn: () => Promise<T>, _why: string): Promise<T | undefined> {
  try {
    return await fn()
  } catch {
    return undefined
  }
}
