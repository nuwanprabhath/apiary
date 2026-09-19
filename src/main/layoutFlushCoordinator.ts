/**
 * Lets `before-quit` wait for a specific renderer's final `reportLayout` call, bounded by a short
 * timeout, instead of guessing how long an IPC round trip takes.
 *
 * The problem this solves: the renderer debounces `reportLayout` ~500ms, so a quit landing inside
 * that window is not hypothetical — closing the last tab in a pane and pressing Cmd+Q well within
 * half a second is an ordinary gesture. `before-quit` asks every window to flush immediately
 * (`CHANNELS.requestLayoutFlush`), but it still needs to know *when* each window's resulting
 * `reportLayout` call has actually landed in `SessionLayoutStore`, so it does not call
 * `SessionLayoutStore.flush()` (which writes to disk) too early. `ipc.ts`'s `reportLayout` handler
 * calls `onReport` with the sender's `webContents.id` the moment it updates the store — that is
 * what resolves the wait.
 *
 * Kept as its own pure module, independent of Electron, the way `sessionLayoutStore.ts` is — so
 * the wait/resolve race can be tested with fake timers rather than a real IPC round trip.
 */
export interface LayoutFlushCoordinator {
  /** Call from the `reportLayout` IPC handler, keyed by `event.sender.id`. */
  onReport(senderId: number): void
  /**
   * Resolves as soon as `onReport(senderId)` is called, or after `timeoutMs`, whichever comes
   * first — a renderer that never answers (closed, hung, or simply has nothing new to report)
   * must not hold up quitting.
   */
  waitFor(senderId: number, timeoutMs?: number): Promise<void>
}

const DEFAULT_TIMEOUT_MS = 500

export function createLayoutFlushCoordinator(): LayoutFlushCoordinator {
  const pending = new Map<number, () => void>()

  return {
    onReport(senderId) {
      pending.get(senderId)?.()
      pending.delete(senderId)
    },
    waitFor(senderId, timeoutMs = DEFAULT_TIMEOUT_MS) {
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(senderId)
          resolve()
        }, timeoutMs)
        pending.set(senderId, () => {
          clearTimeout(timer)
          resolve()
        })
      })
    },
  }
}
