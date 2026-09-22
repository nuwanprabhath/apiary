import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Terminal } from '@xterm/headless'
import { ScreenBuffers } from '../../src/main/pty/screen'

/**
 * What a terminal view attaching to a running pty is given to paint — and why it is a rendered
 * snapshot rather than the pty's raw output.
 *
 * Reported as: click a session and the conversation above the prompt is scrambled, words in the
 * wrong columns and lines printed over each other. The view had replayed the pty's raw bytes into
 * a pane narrower than the one they were produced for, and Claude Code places every word with an
 * absolute cursor column. These tests use real recorded sessions (see activityFixtures.test.ts for
 * where they come from), captured at 120 columns, and view them at narrower widths the way a pane
 * in a split layout does.
 */

const FIXTURES = join(__dirname, '../fixtures/activity')
const RECORDINGS = readdirSync(FIXTURES).filter((n) => n.endsWith('.txt'))
const DRAWN = { cols: 120, rows: 40 }

function write(term: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => { term.write(data, resolve) })
}

function terminal(cols: number, rows: number): Terminal {
  return new Terminal({ cols, rows, scrollback: 1000, allowProposedApi: true })
}

/** Every non-blank line in the buffer, history included, trimmed. */
function lines(term: Terminal): string[] {
  const buf = term.buffer.active
  const out: string[] = []
  for (let i = 0; i < buf.length; i += 1) out.push(buf.getLine(i)?.translateToString(true).trim() ?? '')
  return out.filter((l) => l !== '')
}

/**
 * Lines on `view` whose text appears nowhere in the session as it was really drawn.
 *
 * Wrapping is allowed — a narrower view legitimately splits a long line in two, and each half is
 * still text the session contains. What is not allowed is a line that exists nowhere in the
 * truth: two lines interleaved, or a word printed over another. That is what garbled looks like.
 */
function garbled(view: Terminal, truthText: string): string[] {
  return lines(view).filter((l) => !truthText.includes(l))
}

async function truthOf(raw: string): Promise<string> {
  const term = terminal(DRAWN.cols, DRAWN.rows)
  await write(term, raw)
  const text = lines(term).join(' ')
  term.dispose()
  return text
}

async function snapshotOf(raw: string): Promise<{ data: string; cols: number; rows: number }> {
  const screens = new ScreenBuffers()
  screens.resize('pty', DRAWN.cols, DRAWN.rows)
  screens.write('pty', raw)
  const snap = await screens.snapshot('pty')
  screens.dispose('pty')
  if (snap === null) throw new Error('a pty that printed something has no snapshot')
  return snap
}

describe('ScreenBuffers.snapshot, painted into a view', () => {
  it.each(RECORDINGS)('reproduces %s exactly at the size it was drawn at', async (name) => {
    const raw = readFileSync(join(FIXTURES, name), 'utf8')
    const source = terminal(DRAWN.cols, DRAWN.rows)
    await write(source, raw)

    const snap = await snapshotOf(raw)
    expect({ cols: snap.cols, rows: snap.rows }).toEqual(DRAWN)
    const view = terminal(snap.cols, snap.rows)
    await write(view, snap.data)

    expect(lines(view)).toEqual(lines(source))
  })

  for (const width of [70, 100]) {
    it.each(RECORDINGS)(`garbles nothing in %s when the pane is ${String(width)} columns wide`, async (name) => {
      const raw = readFileSync(join(FIXTURES, name), 'utf8')
      const truth = await truthOf(raw)

      // Painted at the size it was laid out for, and narrowed only afterwards — the order
      // TerminalView follows. Serializing *after* narrowing instead stranded a few characters at
      // the wrap edge (`(stdioH`), which is why the order is part of the fix.
      const snap = await snapshotOf(raw)
      const view = terminal(snap.cols, snap.rows)
      await write(view, snap.data)
      view.resize(width, DRAWN.rows)
      expect(garbled(view, truth)).toEqual([])

      // The same recording replayed as raw bytes, the way views used to be caught up. Asserted so
      // this test demonstrably detects the bug: if the check above ever stopped being able to see
      // garbling, this is what would say so.
      const replayed = terminal(width, DRAWN.rows)
      await write(replayed, raw)
      expect(garbled(replayed, truth).length).toBeGreaterThan(0)
    })
  }

  it('includes history that has scrolled off the screen, not just the screen', async () => {
    // A view attaching late wants the conversation above the prompt as well as the prompt.
    const screens = new ScreenBuffers()
    screens.resize('pty', 40, 10)
    screens.write('pty', Array.from({ length: 60 }, (_, i) => `line ${String(i + 1)}`).join('\r\n'))

    const snap = await screens.snapshot('pty')
    const view = terminal(40, 10)
    await write(view, snap?.data ?? '')

    expect(lines(view)).toContain('line 1')
    expect(lines(view)).toContain('line 60')
  })

  it('includes output written just before it was asked for', async () => {
    // `Terminal.write` parses asynchronously; a snapshot taken before the last chunk is parsed
    // would silently drop it, and the view would start one repaint behind.
    const screens = new ScreenBuffers()
    screens.write('pty', 'written a moment ago')
    const snap = await screens.snapshot('pty')
    expect(snap?.data).toContain('written a moment ago')
  })

  it('is null for a pty that has printed nothing', async () => {
    expect(await new ScreenBuffers().snapshot('never-seen')).toBeNull()
  })
})
