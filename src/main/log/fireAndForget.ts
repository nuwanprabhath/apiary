import { log } from './logger'

/**
 * Runs a background task without waiting on it, but never silently: a rejection is logged instead
 * of becoming an unobserved promise rejection (MAIN-19).
 *
 * Use this in place of `void promise.then(...)` for anything started and left running — a rescan
 * kicked off by a menu item or the watcher, a window load — so a failure at least ends up in the
 * diagnostic log rather than vanishing (ESLint's `no-floating-promises` allows `void` on anything,
 * which is exactly how these went unnoticed).
 */
export function fireAndForget(promise: Promise<unknown>, scope: string): void {
  promise.catch((error: unknown) => {
    log.warn(scope, 'background task failed', { error: error instanceof Error ? error.message : String(error) })
  })
}
