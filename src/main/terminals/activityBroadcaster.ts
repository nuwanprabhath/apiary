/**
 * Coalesces pty data/exit events into at most one `onBroadcast` call per `intervalMs`.
 *
 * A pty's own data/exit changes what `classifyActivity` says about it without any window
 * re-reporting its tabs, so the Active section's dots are re-broadcast on those too. Per chunk, a
 * build log would put out hundreds of broadcasts a second, each making every window re-read every
 * tab's status.
 *
 * Leading edge, then at most one per interval: the first chunk after a quiet period flips the dot
 * to `running` at once, and the trailing call makes the last chunk count, so a session that stops
 * producing output does not stay `running`.
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
