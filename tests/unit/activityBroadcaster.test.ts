import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { classifyActivity, RUNNING_WINDOW_MS } from '@shared/activity'
import { ActivityBroadcaster } from '../../src/main/terminals/activityBroadcaster'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('ActivityBroadcaster', () => {
  it('broadcasts immediately on the leading edge', () => {
    const onBroadcast = vi.fn()
    const b = new ActivityBroadcaster({ onBroadcast, intervalMs: 500 })
    b.notify()
    expect(onBroadcast).toHaveBeenCalledTimes(1)
  })

  it('coalesces calls within the interval into a single trailing broadcast', () => {
    const onBroadcast = vi.fn()
    const b = new ActivityBroadcaster({ onBroadcast, intervalMs: 500 })
    b.notify() // leading edge: broadcasts now
    b.notify()
    b.notify()
    expect(onBroadcast).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(500)
    // The trailing broadcast for the calls that arrived during the window.
    expect(onBroadcast).toHaveBeenCalledTimes(2)
  })

  it('does not broadcast again if nothing happened during the interval', () => {
    const onBroadcast = vi.fn()
    const b = new ActivityBroadcaster({ onBroadcast, intervalMs: 500 })
    b.notify()
    vi.advanceTimersByTime(500)
    expect(onBroadcast).toHaveBeenCalledTimes(1)
  })

  it('a call right after the interval starts a fresh leading edge', () => {
    const onBroadcast = vi.fn()
    const b = new ActivityBroadcaster({ onBroadcast, intervalMs: 500 })
    b.notify()
    vi.advanceTimersByTime(500)
    b.notify()
    expect(onBroadcast).toHaveBeenCalledTimes(2)
  })

  it('dispose stops a pending trailing broadcast', () => {
    const onBroadcast = vi.fn()
    const b = new ActivityBroadcaster({ onBroadcast, intervalMs: 500 })
    b.notify()
    b.notify()
    b.dispose()
    vi.advanceTimersByTime(1000)
    expect(onBroadcast).toHaveBeenCalledTimes(1)
  })

  it('reads the tabs again once the running window has passed after the last output, so a quiet terminal reads idle', () => {
    // An idle claude repaints once (one chunk), then prints nothing for 30 minutes. Each broadcast
    // makes the windows classify the screen at that moment.
    let lastOutputAt = 0
    const seen: string[] = []
    const b = new ActivityBroadcaster({
      onBroadcast: () => { seen.push(classifyActivity('❯ ', lastOutputAt, Date.now(), true)) },
      intervalMs: 500,
      settleMs: RUNNING_WINDOW_MS + 250,
    })
    lastOutputAt = Date.now()
    b.notify()
    vi.advanceTimersByTime(100)
    lastOutputAt = Date.now()
    b.notify()
    vi.advanceTimersByTime(30 * 60_000)
    expect(seen.at(-1)).toBe('idle')
    expect(seen).toEqual(['running', 'running', 'idle'])
  })

  it('re-arms the settle broadcast while output keeps coming, and dispose cancels it', () => {
    const onBroadcast = vi.fn()
    const b = new ActivityBroadcaster({ onBroadcast, intervalMs: 500, settleMs: 2000 })
    for (let i = 0; i < 10; i += 1) { b.notify(); vi.advanceTimersByTime(300) }
    const during = onBroadcast.mock.calls.length
    vi.advanceTimersByTime(1500)
    expect(onBroadcast.mock.calls.length).toBe(during)
    vi.advanceTimersByTime(600)
    expect(onBroadcast.mock.calls.length).toBe(during + 1)
    b.notify()
    b.dispose()
    vi.advanceTimersByTime(5000)
    expect(onBroadcast.mock.calls.length).toBe(during + 2)
  })
})
