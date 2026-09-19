import { Terminal } from '@xterm/headless'

/**
 * A headless terminal per pty, so the app can read what is *on the screen* rather than what was
 * sent to it.
 *
 * This exists because the two are not the same thing, and the difference is not cosmetic. Claude
 * Code is a full-screen TUI: it repaints in place, positions words by jumping the cursor
 * (`ESC[12G` between words rather than a space), moves up to redraw earlier lines, and erases and
 * rewrites its footer several times a second. Pattern-matching the raw byte stream therefore fails
 * in two ways at once — "Do you want to proceed?" is never contiguous in the bytes, so a literal
 * match can never fire; and the stream's newlines are not screen lines, so "the last twelve lines"
 * can reach back across the whole session instead of showing the twelve lines a person can see.
 *
 * Both of those shipped, and the status dot was wrong twice because of them. Rendering is the only
 * honest fix: feed the bytes to a terminal emulator and read its grid.
 *
 * Cheaper than what it replaces, too. The old classifier ran a global regex and a split over the
 * whole 256KB replay buffer on every poll; this writes each chunk once, as it arrives, and reading
 * the screen afterwards is a walk over 40 lines.
 */

/** Used until the real pty reports its size, and by `renderScreen` for recorded fixtures. */
const DEFAULT_COLS = 120
const DEFAULT_ROWS = 40

/** No scrollback: only what is on screen decides what a session is doing right now. */
function createTerminal(cols = DEFAULT_COLS, rows = DEFAULT_ROWS): Terminal {
  return new Terminal({ cols, rows, scrollback: 0, allowProposedApi: true })
}

function readScreen(term: Terminal): string {
  const buf = term.buffer.active
  const lines: string[] = []
  for (let i = 0; i < term.rows; i += 1) {
    // `true` trims trailing whitespace, which the grid is otherwise padded with to full width.
    lines.push(buf.getLine(buf.viewportY + i)?.translateToString(true) ?? '')
  }
  return lines.join('\n')
}

/**
 * Renders a whole captured stream in one go and returns the resulting screen.
 *
 * For tests and fixtures. The running app uses `ScreenBuffers` instead, which keeps a terminal
 * alive per pty rather than replaying everything each time it is asked.
 */
export async function renderScreen(raw: string, cols?: number, rows?: number): Promise<string> {
  const term = createTerminal(cols, rows)
  await new Promise<void>((resolve) => { term.write(raw, resolve) })
  const screen = readScreen(term)
  term.dispose()
  return screen
}

/** One live headless terminal per pty id, written to as output arrives. */
export class ScreenBuffers {
  private terms = new Map<string, Terminal>()
  private sizes = new Map<string, { cols: number; rows: number }>()

  /**
   * Keeps a pty's screen the same shape as the real terminal showing it.
   *
   * Not cosmetic. Claude Code lays its boxes out to the width it is given, so rendering a 200-column
   * session into a 120-column grid re-wraps every line — and a wrap landing mid-phrase is enough to
   * break a match that would otherwise be exact. The grid has to be the size the program thinks it
   * is drawing on.
   */
  resize(id: string, cols: number, rows: number): void {
    this.sizes.set(id, { cols, rows })
    this.terms.get(id)?.resize(cols, rows)
  }

  /** Feeds a chunk to the pty's screen, creating it at the pty's last known size on first use. */
  write(id: string, data: string): void {
    let term = this.terms.get(id)
    if (term === undefined) {
      const size = this.sizes.get(id)
      term = createTerminal(size?.cols, size?.rows)
      this.terms.set(id, term)
    }
    term.write(data)
  }

  /**
   * What is on `id`'s screen now, as plain text lines. Empty for a pty with no screen, which reads
   * the same as a blank one to every caller.
   *
   * Note that `Terminal.write` is asynchronous — a chunk written microseconds ago may not be in the
   * grid yet. That is correct for this caller: the classifier is describing a session a human is
   * looking at, and a repaint that has not landed yet is one they cannot see either.
   */
  read(id: string): string {
    const term = this.terms.get(id)
    return term === undefined ? '' : readScreen(term)
  }

  dispose(id: string): void {
    this.terms.get(id)?.dispose()
    this.terms.delete(id)
    this.sizes.delete(id)
  }
}
