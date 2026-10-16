import type { Terminal } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'
import type { PtyId } from '@shared/domain/ids'
import { readPtySnapshot, repaintOnReconnect, resizePty } from '../../state/terminals'
import { logLine } from '../../state/log'

/**
 * How long catching up may take before the view shows live output anyway. It normally takes a few
 * milliseconds; one that never finished left a terminal that took keystrokes but never drew them.
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
 * A view attaching to a running pty starts with nothing, and a TUI at a prompt may never print
 * again. Replaying the pty's raw output does not work: it was produced at the session's past
 * widths by a program placing words at absolute columns, so in a narrower pane the words overwrite
 * one another. Main hands over a rendered snapshot instead (`ScreenBuffers.snapshot`), and the
 * order matters as much as the snapshot:
 *
 * 1. Paint it at the size it was laid out for.
 * 2. Only once xterm has *parsed* it, fit to the pane and resize the pty, so the program repaints
 *    at the new width. `write()` parses asynchronously while `resize()` applies at once, so
 *    resizing straight after writing would lay the snapshot out at the new width.
 *
 * Live output arriving meanwhile is queued and drained behind the snapshot (writing it first would
 * put the present above the past). `disposed` guards a tab closed before the round trip lands,
 * since writing to a disposed terminal throws.
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
   * Runs app code from an xterm write callback without letting it throw there: xterm calls those
   * mid-parse with no guard, an exception ends the loop, and every later write joins a queue
   * nothing drains.
   */
  const guarded = (what: string, fn: () => void): void => {
    try {
      fn()
    } catch (err) {
      logLine('error', 'pty', `terminal ${what} failed`, { ptyId, error: String(err) })
    }
  }

  /** Loops because output can keep arriving while a batch is being parsed. */
  const drain = (done: () => void): void => {
    if (disposed) return
    if (queued.length === 0) { done(); return }
    const batch = queued.splice(0).join('')
    term.write(batch, () => { guarded('catch-up', () => { drain(done) }) })
  }

  /** On an unchanged size `PtyManager.resize` itself forces the redraw a reattaching view needs. */
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
    // Logged, so a stalled catch-up says which stage it was in.
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
        // Given up on: painting the old screen over live output would put the past below the present.
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
