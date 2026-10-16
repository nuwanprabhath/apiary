import { app } from 'electron'

export interface QuitDeferral {
  /** Read by `WindowManager`'s `closed` handler: a window closing during shutdown must not
   *  delete its layout record. */
  isQuitting: () => boolean
}

/**
 * Defers `app.quit()` until an async `shutdown()` has actually finished.
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
    // Only the quit this handler issues itself, once teardown is done, is allowed through. A
    // *second* request while the first is running (Cmd+Q on top of a window-close quit) is
    // deferred too: letting it through tears the process down mid-teardown, losing the layout
    // flush and leaving the PTYs to Electron's own cleanup — the native abort this exists to avoid.
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
        // unquittable, with every later Cmd+Q deferred forever. A throw still propagates out of
        // this fire-and-forget IIFE; index.ts's `unhandledRejection` handler records it.
        shutdownFinished = true
        app.quit()
      }
    })()
  })
  return { isQuitting: () => quitting }
}
