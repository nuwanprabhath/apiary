import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { attempt, background, bestEffort, reportFailure, setFailureSink, surface } from '../../src/renderer/state/policy'

/** The renderer's error policy (state/policy.ts): which failures are shown, which are logged. */
const logWrite = vi.fn()
const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve() }

beforeEach(() => {
  logWrite.mockClear()
  ;(globalThis as { window?: unknown }).window = { apiary: { logWrite } }
})
afterEach(() => {
  setFailureSink(null)
  delete (globalThis as { window?: unknown }).window
})

describe('error policy', () => {
  it('attempt shows a failure through the sink with its context, and resolves false', async () => {
    const sink = vi.fn()
    setFailureSink(sink)
    const boom = new Error('nope')
    expect(await attempt(Promise.reject(boom), 'Could not do it')).toBe(false)
    expect(sink).toHaveBeenCalledWith(boom, 'Could not do it')
    expect(logWrite).not.toHaveBeenCalled()
  })

  it('attempt resolves true and says nothing when the call worked', async () => {
    const sink = vi.fn()
    setFailureSink(sink)
    expect(await attempt(Promise.resolve(1), 'x')).toBe(true)
    expect(sink).not.toHaveBeenCalled()
  })

  it('surface never leaves an unhandled rejection', async () => {
    const sink = vi.fn()
    setFailureSink(sink)
    surface(Promise.reject(new Error('x')), 'Could not')
    await flush()
    expect(sink).toHaveBeenCalledTimes(1)
  })

  it('with no notification centre mounted a surfaced failure is logged instead of lost', () => {
    reportFailure(new Error('late'), 'Could not')
    expect(logWrite).toHaveBeenCalledWith('warn', 'app', 'background task failed', { error: 'late' })
  })

  it('background logs and never shows', async () => {
    const sink = vi.fn()
    setFailureSink(sink)
    background(Promise.reject(new Error('quiet')), 'tabs')
    await flush()
    expect(sink).not.toHaveBeenCalled()
    expect(logWrite).toHaveBeenCalledWith('warn', 'tabs', 'background task failed', { error: 'quiet' })
  })

  it('bestEffort gives the value, or null after logging', async () => {
    expect(await bestEffort(Promise.resolve(5), 'app')).toBe(5)
    expect(await bestEffort(Promise.reject(new Error('gone')), 'app')).toBeNull()
    expect(logWrite).toHaveBeenCalledTimes(1)
  })
})
