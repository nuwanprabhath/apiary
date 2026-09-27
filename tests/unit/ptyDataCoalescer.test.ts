import { describe, it, expect, vi } from 'vitest'
import { PtyDataCoalescer } from '../../src/main/terminals/ptyDataCoalescer'

/** A manually-driven `schedule`: `run()` fires every callback scheduled since the last run, in
 *  the order they were scheduled — a stand-in for `setImmediate` that a test can step by hand
 *  instead of racing the real event loop. */
function manualScheduler(): { schedule: (cb: () => void) => { cancel: () => void }; run: () => void } {
  let pending: Array<{ cb: () => void; cancelled: boolean }> = []
  return {
    schedule: (cb) => {
      const entry = { cb, cancelled: false }
      pending.push(entry)
      return { cancel: () => { entry.cancelled = true } }
    },
    run: () => {
      const batch = pending
      pending = []
      for (const entry of batch) if (!entry.cancelled) entry.cb()
    },
  }
}

describe('PtyDataCoalescer', () => {
  it('flushes a single chunk unchanged', () => {
    const onFlush = vi.fn()
    const { schedule, run } = manualScheduler()
    const c = new PtyDataCoalescer({ onFlush, schedule })
    c.push('p1', 'hello')
    expect(onFlush).not.toHaveBeenCalled()
    run()
    expect(onFlush).toHaveBeenCalledExactlyOnceWith('p1', 'hello')
  })

  it('joins several chunks for the same pty into one flush, in arrival order', () => {
    const onFlush = vi.fn()
    const { schedule, run } = manualScheduler()
    const c = new PtyDataCoalescer({ onFlush, schedule })
    c.push('p1', 'a')
    c.push('p1', 'b')
    c.push('p1', 'c')
    run()
    expect(onFlush).toHaveBeenCalledExactlyOnceWith('p1', 'abc')
  })

  it('flushes different ptys independently, each with its own concatenation', () => {
    const onFlush = vi.fn()
    const { schedule, run } = manualScheduler()
    const c = new PtyDataCoalescer({ onFlush, schedule })
    c.push('p1', 'a1')
    c.push('p2', 'b1')
    c.push('p1', 'a2')
    run()
    expect(onFlush).toHaveBeenCalledWith('p1', 'a1a2')
    expect(onFlush).toHaveBeenCalledWith('p2', 'b1')
    expect(onFlush).toHaveBeenCalledTimes(2)
  })

  it('a chunk after a flush schedules a fresh one rather than reusing the drained buffer', () => {
    const onFlush = vi.fn()
    const { schedule, run } = manualScheduler()
    const c = new PtyDataCoalescer({ onFlush, schedule })
    c.push('p1', 'first')
    run()
    c.push('p1', 'second')
    run()
    expect(onFlush).toHaveBeenNthCalledWith(1, 'p1', 'first')
    expect(onFlush).toHaveBeenNthCalledWith(2, 'p1', 'second')
  })

  it('dispose cancels pending flushes without sending them', () => {
    const onFlush = vi.fn()
    const { schedule, run } = manualScheduler()
    const c = new PtyDataCoalescer({ onFlush, schedule })
    c.push('p1', 'never sent')
    c.dispose()
    run()
    expect(onFlush).not.toHaveBeenCalled()
  })
})
