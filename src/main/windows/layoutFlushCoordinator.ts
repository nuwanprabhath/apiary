/**
 * Lets `before-quit` wait for a specific renderer's final `reportLayout` call, bounded by a short
 * timeout.
 *
 * The renderer debounces `reportLayout` ~500ms, so a quit can land inside that window.
 * `before-quit` asks every window to flush immediately (`CHANNELS.requestLayoutFlush`) and must
 * know when each resulting `reportLayout` has landed in `SessionLayoutStore` before it calls
 * `SessionLayoutStore.flush()`. The `reportLayout` handler calls `onReport` with the sender's
 * `webContents.id` the moment it updates the store, which resolves the wait.
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
