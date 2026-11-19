import { RUNNING_WINDOW_MS } from '@shared/activity'

/** How far past the running window the last read lands, so the output is clearly behind it. */
const SETTLE_MARGIN_MS = 250

/**
 * Coalesces pty data/exit events into at most one `onBroadcast` call per `intervalMs`.
 *
 * A pty's own data/exit changes what `classifyActivity` says about it without any window
 * re-reporting its tabs, so the Active section's dots are re-broadcast on those too. Per chunk, a
 * build log would put out hundreds of broadcasts a second, each making every window re-read every
 * tab's status.
 *
 * Leading edge, then at most one per interval: the first chunk after a quiet period flips the dot
 * to `running` at once, and the trailing call makes the last chunk count.
 *
 * Then one more, `settleMs` after the last chunk: output counts as running for a while after it
 * arrives (`RUNNING_WINDOW_MS`), so every broadcast above still reads `running`. Without a broadcast
 * once that window has passed, a terminal that printed once and went quiet kept its running ring
 * until something unrelated asked again; an idle claude that repaints every 30 minutes showed as
 * busy for half an hour at a time.
 */
export class ActivityBroadcaster {
  private timer: NodeJS.Timeout | null = null
  private pending = false
  private readonly intervalMs: number
  private readonly onBroadcast: () => void
  private readonly settleMs: number
  /** The broadcast after output has gone quiet. Invalidated by every `notify`, which re-arms it. */
  private settle: NodeJS.Timeout | null = null

  constructor(options: { onBroadcast: () => void; intervalMs?: number; settleMs?: number }) {
    this.onBroadcast = options.onBroadcast
    this.intervalMs = options.intervalMs ?? 500
    this.settleMs = options.settleMs ?? RUNNING_WINDOW_MS + SETTLE_MARGIN_MS
  }

  /** Call on every pty data chunk or exit. */
  notify(): void {
    this.armSettle()
    if (this.timer !== null) { this.pending = true; return }
    this.onBroadcast()
    this.timer = setTimeout(() => {
      this.timer = null
      if (this.pending) { this.pending = false; this.notify() }
    }, this.intervalMs)
  }

  dispose(): void {
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null }
    if (this.settle !== null) { clearTimeout(this.settle); this.settle = null }
  }

  private armSettle(): void {
    if (this.settle !== null) clearTimeout(this.settle)
    this.settle = setTimeout(() => { this.settle = null; this.onBroadcast() }, this.settleMs)
  }
}
