import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSessionLayoutStore } from '../../src/main/windows/sessionLayoutStore'

let dir: string
const file = () => join(dir, 'session-layout.json')

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'apiary-layout-'))
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  rmSync(dir, { recursive: true, force: true })
})

/** What a fresh launch would read back from the file. */
const onDisk = () => createSessionLayoutStore(file(), 500).snapshot()

const bounds = { x: 10, y: 20, width: 1200, height: 800 }
const layout = { preset: 'halves-h', panes: [
  { id: 'col-1', tabs: [{ key: 'sess-1', view: 'terminal' as const, shells: [{ id: 'shell:sess-1:1', name: 'zsh' }], activeShell: 'shell:sess-1:1' }], activeTab: 'sess-1' },
] }

describe('SessionLayoutStore', () => {
  it('round-trips a window report through a debounced write', () => {
    const store = createSessionLayoutStore(file(), 500)
    store.reportBounds(1, bounds)
    store.reportLayout({ number: 1, layout, live: ['sess-1'] })
    // Nothing written yet — the 500ms debounce has not elapsed.
    expect(() => readFileSync(file(), 'utf8')).toThrow()
    vi.advanceTimersByTime(499)
    expect(() => readFileSync(file(), 'utf8')).toThrow()
    vi.advanceTimersByTime(1)
    expect(onDisk().windows).toEqual([{ number: 1, bounds, layout, live: ['sess-1'], hasLayout: true }])
  })

  it('marks a bounds-only record as not having a real layout, and flush() preserves that if quit lands inside the renderer debounce', () => {
    // A new window is opened and immediately moved/resized: `reportBounds` arrives, but the
    // renderer's own 500ms layout debounce has not fired yet — then the app quits and calls
    // flush() before it ever does. The written record must not look like a window the user
    // emptied out on purpose (`hasLayout: false`, not the ambiguous `hasLayout: true`).
    const store = createSessionLayoutStore(file(), 500)
    store.reportBounds(2, bounds)
    store.flush()
    expect(onDisk().windows).toEqual([
      { number: 2, bounds, layout: { preset: 'single', panes: [] }, live: [], hasLayout: false },
    ])
  })

  it('a later reportLayout call turns hasLayout true, replacing the bounds-only placeholder', () => {
    const store = createSessionLayoutStore(file(), 500)
    store.reportBounds(1, bounds)
    expect(store.snapshot().windows[0].hasLayout).toBe(false)
    store.reportLayout({ number: 1, layout, live: ['sess-1'] })
    expect(store.snapshot().windows[0]).toEqual({ number: 1, bounds, layout, live: ['sess-1'], hasLayout: true })
  })

  it('coalesces rapid reports into a single write after the debounce settles', () => {
    const store = createSessionLayoutStore(file(), 500)
    store.reportLayout({ number: 1, layout, live: [] })
    vi.advanceTimersByTime(300)
    store.reportLayout({ number: 1, layout: { ...layout, preset: 'single' }, live: ['sess-2'] })
    vi.advanceTimersByTime(499)
    expect(() => readFileSync(file(), 'utf8')).toThrow()
    vi.advanceTimersByTime(1)
    expect(onDisk().windows[0].live).toEqual(['sess-2'])
  })

  it('flush() writes immediately, for before-quit', () => {
    const store = createSessionLayoutStore(file(), 500)
    store.reportLayout({ number: 1, layout, live: ['sess-1'] })
    store.flush()
    expect(onDisk().windows[0].number).toBe(1)
  })

  it('removeWindow drops a closed window from the next write', () => {
    const store = createSessionLayoutStore(file(), 500)
    store.reportLayout({ number: 1, layout, live: [] })
    store.reportLayout({ number: 2, layout, live: [] })
    store.removeWindow(1)
    store.flush()
    expect(onDisk().windows.map((w) => w.number)).toEqual([2])
  })

  it('falls back to an empty file when the JSON on disk is corrupt', () => {
    writeFileSync(file(), '{not json')
    expect(onDisk()).toEqual({ windows: [] })
  })

  it('falls back to an empty file when the JSON is well-formed but the wrong shape', () => {
    writeFileSync(file(), JSON.stringify({ windows: 'nope' }))
    expect(onDisk()).toEqual({ windows: [] })
  })
})

describe('the layout file is written atomically (MAIN-16)', () => {
  const report = { number: 1, layout, live: ['sess-1'] }

  it('leaves no temp file behind after a normal save, and records a version', () => {
    const store = createSessionLayoutStore(file(), 500)
    store.reportBounds(1, bounds)
    store.reportLayout(report)
    store.flush()
    expect(readdirSync(dir)).toEqual(['session-layout.json'])
    expect(JSON.parse(readFileSync(file(), 'utf8'))).toMatchObject({ version: 1 })
  })

  it('still reads a file written before it carried a version', () => {
    const record = { number: 1, bounds, layout, live: ['sess-1'], hasLayout: true }
    writeFileSync(file(), JSON.stringify({ windows: [record] }))
    expect(onDisk()).toEqual({ windows: [record] })
  })

  it('a crash between write and rename keeps the old file, rather than a truncated one', () => {
    const store = createSessionLayoutStore(file(), 500)
    store.reportBounds(1, bounds)
    store.reportLayout(report)
    store.flush()
    const first = onDisk()
    chmodSync(dir, 0o500)
    try {
      store.removeWindow(1)
      store.flush()
    } finally {
      chmodSync(dir, 0o700)
    }
    expect(onDisk()).toEqual(first)
    expect(readdirSync(dir)).toEqual(['session-layout.json'])
  })
})
