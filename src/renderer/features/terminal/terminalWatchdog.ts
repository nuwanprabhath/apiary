import type { Terminal } from '@xterm/xterm'
import type { PtyId } from '@shared/domain/ids'
import { logLine } from '../../state/log'

/**
 * How long after output arrives xterm may take to parse it and draw, before the view counts as
 * stuck and is rebuilt (what closing and reopening the tab did by hand). Generous: a busy terminal
 * parses in time slices, and drawing waits for the next frame.
 */
const STALL_MS = 4000
/** A view rebuilt this many times in a minute stops trying, rather than rebuilding forever. */
const MAX_REBUILDS_PER_MINUTE = 3

/** On screen and in front: the only state in which "nothing was drawn" means something is wrong.
 *  A hidden tab, a background window and a minimised one all legitimately draw nothing. */
function inView(el: HTMLElement | null): boolean {
  if (el === null || document.visibilityState !== 'visible' || !document.hasFocus()) return false
  if (!el.checkVisibility()) return false
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0
}

/** Rebuilds the view (`bump`) unless it already did so too often in the last minute. `history`
 *  holds the times of recent rebuilds and outlives the xterm it guards. */
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
  /** Output arrived (shown or queued); remembered so a check that ends healthy knows whether
   *  output that came in after its probe still needs checking. */
  noteData: () => void
  /** Output was shown: check, at most once per `STALL_MS`, that xterm parses and draws it. */
  check: () => void
  dispose: () => void
}

/**
 * The stall watchdog. After output arrives, checks that xterm both parsed it and drew afterwards;
 * if either never happens while the terminal is on screen and in front, `rebuild` is called — the
 * view then becomes a fresh xterm caught up from a fresh snapshot.
 */
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
      // Parsed: now ask for a full redraw and see whether one happens. A renderer that has
      // paused itself (xterm pauses while it believes it is off screen) never draws again.
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
