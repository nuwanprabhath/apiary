import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createLayoutFlushCoordinator } from '../../src/main/layoutFlushCoordinator'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('LayoutFlushCoordinator', () => {
  it('resolves waitFor as soon as onReport fires for that sender, without waiting for the timeout', async () => {
    const coordinator = createLayoutFlushCoordinator()
    let resolved = false
    const wait = coordinator.waitFor(1, 500).then(() => { resolved = true })
    await vi.advanceTimersByTimeAsync(10)
    expect(resolved).toBe(false)
    coordinator.onReport(1)
    await wait
    expect(resolved).toBe(true)
  })

  it('times out and resolves anyway when the sender never reports', async () => {
    const coordinator = createLayoutFlushCoordinator()
    let resolved = false
    const wait = coordinator.waitFor(1, 500).then(() => { resolved = true })
    await vi.advanceTimersByTimeAsync(499)
    expect(resolved).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await wait
    expect(resolved).toBe(true)
  })

  it('keeps senders independent — one reporting does not resolve another\'s wait', async () => {
    const coordinator = createLayoutFlushCoordinator()
    let resolvedTwo = false
    const waitTwo = coordinator.waitFor(2, 500).then(() => { resolvedTwo = true })
    coordinator.onReport(1)
    await vi.advanceTimersByTimeAsync(10)
    expect(resolvedTwo).toBe(false)
    coordinator.onReport(2)
    await waitTwo
    expect(resolvedTwo).toBe(true)
  })

  it('a report with nobody waiting is a harmless no-op', () => {
    const coordinator = createLayoutFlushCoordinator()
    expect(() => { coordinator.onReport(99) }).not.toThrow()
  })
})
