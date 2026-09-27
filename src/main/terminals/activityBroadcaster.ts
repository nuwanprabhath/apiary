/**
 * Coalesces pty data/exit events into at most one `onBroadcast` call per `intervalMs` (MAIN-13 step
 * 3), pulled out of `ipc/handlers/tabs.ts`'s composition so the leading/trailing-edge behaviour can
 * be driven directly in a unit test with fake timers, instead of only through a live `PtyManager`.
 *
 * A pty's own data/exit changes what `classifyActivity` would say about it without any window
 * re-reporting its tabs, so the Active section's dots have to be re-broadcast on those too — but
 * pty output is not an event, it is a stream: broadcasting per chunk meant a build log in one
 * terminal put out hundreds of broadcasts a second, each of which made every open window re-read
 * every tab's status and re-sort the Recent section.
 *
 * Leading edge, then at most one broadcast per interval: the first chunk after a quiet period flips
 * the dot to `running` immediately, and the trailing call is what makes the *last* chunk count —
 * without it a session that stops producing output would sit showing `running` until something
 * unrelated happened to broadcast.
 */
export class ActivityBroadcaster {
  private timer: NodeJS.Timeout | null = null
  private pending = false
  private readonly intervalMs: number
  private readonly onBroadcast: () => void

  constructor(options: { onBroadcast: () => void; intervalMs?: number }) {
    this.onBroadcast = options.onBroadcast
    this.intervalMs = options.intervalMs ?? 500
  }

  /** Call on every pty data chunk or exit. */
  notify(): void {
    if (this.timer !== null) { this.pending = true; return }
    this.onBroadcast()
    this.timer = setTimeout(() => {
      this.timer = null
      if (this.pending) { this.pending = false; this.notify() }
    }, this.intervalMs)
  }

  dispose(): void {
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null }
  }
}
