import type { Terminal } from '@xterm/xterm'
import type { PtyId } from '@shared/domain/ids'
import { logLine } from '../../state/log'

/** Generous: a busy terminal parses in time slices, and drawing waits for the next frame. */
const STALL_MS = 4000
const MAX_REBUILDS_PER_MINUTE = 3

/** On screen and in front: the only state in which "nothing was drawn" means something is wrong.
 *  A hidden tab, a background window and a minimised one all legitimately draw nothing. */
function inView(el: HTMLElement | null): boolean {
  if (el === null || document.visibilityState !== 'visible' || !document.hasFocus()) return false
  if (!el.checkVisibility()) return false
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0
}

/** `history` holds the times of recent rebuilds and outlives the xterm it guards. */
export function requestRebuild(history: number[], ptyId: PtyId, why: Record<string, unknown>, bump: () => void): void {
  const now = Date.now()
  const recent = history.filter((t) => now - t < 60_000)
  history.splice(0, history.length, ...recent)
  if (history.length >= MAX_REBUILDS_PER_MINUTE) {
    logLine('error', 'pty', 'terminal keeps getting stuck; not rebuilding again', { ptyId, ...why })
    return
  }
  history.push(now)
  logLine('warn', 'pty', 'terminal stopped drawing; rebuilt it', { ptyId, ...why })
  bump()
}

export interface StallWatchdog {
  /** Output arrived (shown or queued), so a healthy check knows if later output needs checking. */
  noteData: () => void
  /** At most once per `STALL_MS`. */
  check: () => void
  dispose: () => void
}

/** If xterm never parses or never draws output while the terminal is in view, `rebuild` is called. */
export function createStallWatchdog(
  term: Terminal,
  host: () => HTMLElement | null,
  rebuild: (why: Record<string, unknown>) => void,
): StallWatchdog {
  let disposed = false
  let lastRenderAt = 0
  const disposeRender = term.onRender(() => { lastRenderAt = performance.now() })
  let watch: number | null = null
  let lastDataAt = 0
  const check = (): void => {
    if (watch !== null || disposed) return
    let parsed = false
    const probedAt = performance.now()
    term.write('', () => { parsed = true })
    // Output that arrived after the probe was written is not covered by it: check again.
    const again = (): void => { if (lastDataAt > probedAt) check() }
    watch = window.setTimeout(() => {
      watch = null
      if (disposed) return
      if (!inView(host())) { again(); return }
      if (!parsed) { rebuild({ parsed }); return }
      // xterm pauses its renderer while it believes it is off screen, and then never draws again.
      const askedAt = performance.now()
      term.refresh(0, term.rows - 1)
      watch = window.setTimeout(() => {
        watch = null
        if (disposed) return
        if (inView(host()) && lastRenderAt < askedAt) { rebuild({ parsed, rendered: false }); return }
        again()
      }, 1000)
    }, STALL_MS)
  }
  return {
    noteData: () => { lastDataAt = performance.now() },
    check,
    dispose: () => {
      disposed = true
      if (watch !== null) window.clearTimeout(watch)
      disposeRender.dispose()
    },
  }
}
