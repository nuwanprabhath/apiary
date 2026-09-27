import { app } from 'electron'

export interface QuitDeferral {
  /** Whether shutdown has started — read by `WindowManager`'s `closed` handler (see its own
   *  comment on why a window closing during shutdown must not delete its layout record). */
  isQuitting: () => boolean
}

/**
 * Defers `app.quit()` until an async `shutdown()` has actually finished (MAIN-15 step 4) — pure
 * move of `index.ts`'s `before-quit` wiring, including the `quitting`/`shutdownFinished` flags.
 *
 * A running PTY delivers its output/exit events into the renderer through a native (node-pty)
 * background thread. If Electron's own teardown (Node environment cleanup) starts while one of
 * those events is still in flight, the callback can throw *after* there is no JS context left to
 * catch it — an uncaught native exception that aborts the whole process (SIGABRT) rather than a
 * catchable JS error. `before-quit` fires synchronously before that teardown begins, so quitting
 * is deferred here just long enough for every live PTY to actually exit
 * (`AppService.dispose()`/`PtyManager.killAll()` wait on each child's real exit, bounded by a
 * short timeout) before letting quit proceed.
 */
export function installQuitDeferral(shutdown: () => Promise<void>): QuitDeferral {
  let quitting = false
  let shutdownFinished = false
  app.on('before-quit', (event) => {
    // The one quit that is allowed through: the one this handler issues itself once teardown is
    // done. Everything else is deferred, including a *second* request arriving while the first is
    // still running — a Cmd+Q on top of a window-close quit, or a test harness calling
    // `app.quit()` twice. Letting that second one through (as simply returning early used to)
    // tears the process down in the middle of the teardown it asked for, losing the layout flush
    // and leaving the PTYs to be reaped by Electron's own cleanup — the native abort the
    // deferral exists to avoid.
    if (shutdownFinished) return
    event.preventDefault()
    if (quitting) return
    quitting = true
    void (async () => {
      try {
        await shutdown()
      } finally {
        // `preventDefault()` above has already stopped this quit, so anything that throws on the
        // way through must not be allowed to skip `app.quit()` — the app would then be
        // unquittable, with every later Cmd+Q deferred forever. Losing some saved state on a bad
        // shutdown is survivable; an app that cannot be quit is not. A throw here still propagates
        // out of this fire-and-forget IIFE as before — index.ts's `unhandledRejection` handler is
        // what records it.
        shutdownFinished = true
        app.quit()
      }
    })()
  })
  return { isQuitting: () => quitting }
}
