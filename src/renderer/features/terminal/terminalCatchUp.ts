import type { Terminal } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'
import type { PtyId } from '@shared/domain/ids'
import { readPtySnapshot, repaintOnReconnect, resizePty } from '../../state/terminals'
import { logLine } from '../../state/log'

/**
 * How long a view may spend catching up (snapshot fetched, painted, live output drained behind it)
 * before it gives up waiting and shows live output anyway. Catching up normally takes a few
 * milliseconds; one that never finished left a terminal that took keystrokes but never drew them,
 * stuck at the snapshot's width — reported from Ubuntu, cured only by closing the tab.
 */
const CATCH_UP_TIMEOUT_MS = 4000

export interface CatchUp {
  /** Starts the snapshot round trip. Call once the pty's output is being received. */
  begin: () => void
  /** Live output: written at once when caught up (true), queued behind the snapshot otherwise. */
  receive: (data: string) => boolean
  /** Fits to the pane and tells the pty if the size changed; nothing until the snapshot is in. */
  refit: () => void
  dispose: () => void
}

/**
 * Catch a fresh xterm up on the pty it is attaching to, *then* size it to the pane.
 *
 * A view attaching to a running pty — a tab switched back to, a session opened in a second
 * window, a tab moved between panes — starts with nothing, and a TUI sitting at a prompt may
 * never print again. It used to be caught up by replaying the pty's raw output, but that
 * output was produced at whatever widths the session had over its life, by a program that
 * places each word at an absolute column. Replayed into a narrower pane the words landed in
 * the wrong columns and overwrote one another — the scrambled conversation above an intact
 * prompt that was reported.
 *
 * So the main process hands over a rendered snapshot instead (`ScreenBuffers.snapshot`), and
 * the order here is the fix as much as the snapshot is:
 *
 * 1. Paint it at the size it was laid out for.
 * 2. Only once xterm has *parsed* it, fit to the pane and resize the pty — which makes the
 *    program repaint itself at the new width. `write()` parses asynchronously while
 *    `resize()` applies at once, so resizing straight after writing would lay the snapshot
 *    out at the new width after all, which is the bug again by another route.
 *
 * Live output arriving meanwhile is queued, not written, and drained in order behind the
 * snapshot: writing it first would put the present above the past. `disposed` guards a tab
 * closed before the round trip lands, since writing to a disposed terminal throws.
 */
export function createCatchUp(term: Terminal, fit: FitAddon, ptyId: PtyId, onGaveUp: () => void): CatchUp {
  let disposed = false
  let caughtUp = false
  // Which step catching up is on, for the log line if it never finishes.
  let stage: 'snapshot' | 'paint' | 'drain' = 'snapshot'
  const queued: string[] = []
  let lastCols = term.cols
  let lastRows = term.rows
  let catchUpTimer: number | null = null
  let offRepaint: (() => void) | null = null

  /**
   * Runs app code from inside an xterm write callback without letting it throw there. xterm calls
   * those callbacks in the middle of its parse loop with no guard: an exception ends the loop
   * before it schedules the next batch, and every later write joins a queue nothing drains — a
   * terminal that still sends what you type but never draws again.
   */
  const guarded = (what: string, fn: () => void): void => {
    try {
      fn()
    } catch (err) {
      logLine('error', 'pty', `terminal ${what} failed`, { ptyId, error: String(err) })
    }
  }

  /** Writes whatever has queued up, and calls `done` once xterm has parsed all of it. Loops
   *  because output can keep arriving while a batch is being parsed. */
  const drain = (done: () => void): void => {
    if (disposed) return
    if (queued.length === 0) { done(); return }
    const batch = queued.splice(0).join('')
    term.write(batch, () => { guarded('catch-up', () => { drain(done) }) })
  }

  /** Fits to the pane and tells the pty. On an unchanged size `PtyManager.resize` itself forces
   *  the redraw a reattaching view needs — see the comment on `resize()` in ptyManager.ts. */
  const settle = (): void => {
    fit.fit()
    lastCols = term.cols
    lastRows = term.rows
    resizePty(ptyId, term.cols, term.rows)
  }
  const finishCatchUp = (): void => {
    if (caughtUp) return
    caughtUp = true
    settle()
  }

  const begin = (): void => {
    // Caught up or not, live output is shown after this long: a view that waits forever for a
    // round trip that is never coming is the stuck terminal. Logged, so the next one says where.
    catchUpTimer = window.setTimeout(() => {
      if (disposed || caughtUp) return
      logLine('warn', 'pty', 'terminal catch-up stalled; showing live output', { ptyId, stage, queued: queued.length })
      const late = queued.splice(0).join('')
      guarded('catch-up', finishCatchUp)
      if (late !== '') term.write(late)
      onGaveUp()
    }, CATCH_UP_TIMEOUT_MS)

    void readPtySnapshot(ptyId)
      .then((snap) => new Promise<void>((resolve) => {
        // Given up on (above): live output is already on screen, and painting the old screen over
        // it now would put the past below the present.
        if (disposed || caughtUp || snap === null) { resolve(); return }
        stage = 'paint'
        term.resize(snap.cols, snap.rows)
        term.write(snap.data, resolve)
      }))
      .finally(() => {
        stage = 'drain'
        drain(finishCatchUp)
      })
    // Back from a dropped connection: the screen may have changed while no output reached us.
    offRepaint = repaintOnReconnect(ptyId, (snap) => {
      if (disposed || !caughtUp) return
      term.reset()
      term.resize(snap.cols, snap.rows)
      term.write(snap.data)
    })
  }

  return {
    begin,
    receive: (data) => {
      if (!caughtUp) { queued.push(data); return false }
      term.write(data)
      return true
    },
    refit: () => {
      if (!caughtUp) return
      fit.fit()
      if (term.cols !== lastCols || term.rows !== lastRows) {
        lastCols = term.cols
        lastRows = term.rows
        resizePty(ptyId, term.cols, term.rows)
      }
    },
    dispose: () => {
      disposed = true
      if (catchUpTimer !== null) window.clearTimeout(catchUpTimer)
      offRepaint?.()
    },
  }
}
