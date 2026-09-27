import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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
})
