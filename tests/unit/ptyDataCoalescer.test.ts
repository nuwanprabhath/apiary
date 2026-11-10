import { describe, it, expect, vi } from 'vitest'
import { FLUSH_CAP, PtyDataCoalescer } from '../../src/main/terminals/ptyDataCoalescer'
import { PTY_HIGH_WATER, PTY_LOW_WATER, WindowAttachments } from '../../src/main/windows/windowAttachments'

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

  it('sends at most 256 KB in one flush and carries the rest to the next tick, in order', () => {
    const onFlush = vi.fn()
    const { schedule, run } = manualScheduler()
    const c = new PtyDataCoalescer({ onFlush, schedule })
    c.push('p1', 'a'.repeat(FLUSH_CAP + 10))
    c.push('p1', 'b')
    run()
    expect(onFlush).toHaveBeenCalledExactlyOnceWith('p1', 'a'.repeat(FLUSH_CAP))
    run()
    expect(onFlush).toHaveBeenLastCalledWith('p1', 'a'.repeat(10) + 'b')
    expect(onFlush).toHaveBeenCalledTimes(2)
  })

  it('never splits a character made of two UTF-16 units across flushes', () => {
    const onFlush = vi.fn()
    const { schedule, run } = manualScheduler()
    const c = new PtyDataCoalescer({ onFlush, schedule })
    c.push('p1', 'a'.repeat(FLUSH_CAP - 1) + '😀')
    run()
    run()
    expect(onFlush.mock.calls.map((call: unknown[]) => call[1])).toEqual(['a'.repeat(FLUSH_CAP - 1), '😀'])
  })

  it('tells observers what each flush sent', () => {
    const { schedule, run } = manualScheduler()
    const c = new PtyDataCoalescer({ onFlush: () => {}, schedule })
    const seen = vi.fn()
    c.onFlushed(seen)
    c.push('p1', 'xy')
    run()
    expect(seen).toHaveBeenCalledExactlyOnceWith('p1', 'xy')
  })
})

describe('pty flow control (WindowAttachments)', () => {
  const PTY = 'pty-1'
  function setup(): { a: WindowAttachments; pause: ReturnType<typeof vi.fn>; resume: ReturnType<typeof vi.fn> } {
    const target = { isDestroyed: () => false, send: () => {} }
    const a = new WindowAttachments(() => target)
    const pause = vi.fn()
    const resume = vi.fn()
    a.controlFlow({ pause, resume })
    return { a, pause, resume }
  }

  it('pauses a pty once a window has 1 MB it has not acknowledged, and resumes it when it catches up', () => {
    const { a, pause, resume } = setup()
    a.attach(1, PTY)
    a.recordSent(PTY, PTY_HIGH_WATER - 1)
    expect(pause).not.toHaveBeenCalled()
    a.recordSent(PTY, 1)
    expect(pause).toHaveBeenCalledExactlyOnceWith(PTY)
    a.recordSent(PTY, 100)
    expect(pause).toHaveBeenCalledTimes(1)
    a.acknowledge(1, PTY, PTY_HIGH_WATER - PTY_LOW_WATER)
    expect(resume).not.toHaveBeenCalled()
    a.acknowledge(1, PTY, 100)
    expect(resume).toHaveBeenCalledExactlyOnceWith(PTY)
  })

  it('never pauses a pty no window is attached to', () => {
    const { a, pause } = setup()
    a.recordSent(PTY, PTY_HIGH_WATER * 4)
    expect(pause).not.toHaveBeenCalled()
  })

  it('goes at the pace of the slowest window', () => {
    const { a, pause, resume } = setup()
    a.attach(1, PTY)
    a.attach(2, PTY)
    a.recordSent(PTY, PTY_HIGH_WATER)
    a.acknowledge(1, PTY, PTY_HIGH_WATER)
    expect(pause).toHaveBeenCalledTimes(1)
    expect(resume).not.toHaveBeenCalled()
  })

  it('resumes the pty when the slow window detaches, or closes', () => {
    const { a, pause, resume } = setup()
    a.attach(1, PTY)
    a.attach(2, PTY)
    a.recordSent(PTY, PTY_HIGH_WATER)
    a.acknowledge(1, PTY, PTY_HIGH_WATER)
    a.detach(2, PTY)
    expect(resume).toHaveBeenCalledExactlyOnceWith(PTY)

    a.recordSent(PTY, PTY_HIGH_WATER)
    expect(pause).toHaveBeenCalledTimes(2)
    a.detachWindow(1)
    expect(resume).toHaveBeenCalledTimes(2)
  })

  it('ignores an acknowledgement for more than was sent, or from a window not attached', () => {
    const { a, pause } = setup()
    a.attach(1, PTY)
    a.acknowledge(1, PTY, 10 * PTY_HIGH_WATER)
    a.acknowledge(7, PTY, 5)
    a.recordSent(PTY, PTY_HIGH_WATER)
    expect(pause).toHaveBeenCalledOnce()
  })
})
