import { Terminal } from '@xterm/headless'
import { SerializeAddon } from '@xterm/addon-serialize'
import type { PtySnapshot } from '@shared/api'

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

/**
 * Lines of history a live pty's screen keeps, so a view attaching late can be handed the
 * conversation above the prompt and not only the prompt. The status classifier is unaffected:
 * it reads the viewport, which in a headless terminal nobody scrolls always sits at the bottom.
 */
const LIVE_SCROLLBACK = 1000

function createTerminal(cols = DEFAULT_COLS, rows = DEFAULT_ROWS, scrollback = 0): Terminal {
  return new Terminal({ cols, rows, scrollback, allowProposedApi: true })
}

/** What a view needs to paint a pty's screen as it is. Defined in `shared/` because the renderer
 *  receives it over IPC. */
export type ScreenSnapshot = PtySnapshot

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
  private serializers = new Map<string, SerializeAddon>()
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
      term = createTerminal(size?.cols, size?.rows, LIVE_SCROLLBACK)
      const serializer = new SerializeAddon()
      term.loadAddon(serializer)
      this.terms.set(id, term)
      this.serializers.set(id, serializer)
    }
    term.write(data)
  }

  /**
   * The pty's screen and history as escape sequences that repaint it, at the size it was drawn at.
   *
   * This, not the raw byte stream, is what a view attaching to a running pty is given. The bytes
   * were produced at whatever widths the session had over its life, by a program that places each
   * word with an absolute cursor column; replayed into a pane of a different width they land in
   * the wrong columns and overwrite one another. Measured on recorded Claude sessions viewed at a
   * narrower width, the raw replay garbled 156 lines across the recordings — this garbled none,
   * provided the view paints it at `cols`×`rows` and only *then* resizes (serializing after
   * narrowing left a few characters stranded at the wrap edge). `tests/unit/screenSnapshot.test.ts`
   * holds that measurement.
   *
   * Waits for writes still queued in the emulator, so the snapshot includes everything received.
   */
  async snapshot(id: string): Promise<ScreenSnapshot | null> {
    const term = this.terms.get(id)
    const serializer = this.serializers.get(id)
    if (term === undefined || serializer === undefined) return null
    await new Promise<void>((resolve) => { term.write('', resolve) })
    return { data: serializer.serialize(), cols: term.cols, rows: term.rows }
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
    this.serializers.delete(id)
    this.sizes.delete(id)
  }
}
