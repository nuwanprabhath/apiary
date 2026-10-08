/**
 * `onFocusedTick` is the one shared timer behind the git toolbar's branch re-read (the polling that
 * used to be a `setInterval` in each pane's `useGitStatus`): one timer however many subscribers,
 * silent while the window is unfocused, gone when the last subscriber leaves.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { onFocusedTick } from '../../src/renderer/state/focusedTick'

describe('onFocusedTick', () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  it('serves every subscriber from one timer, only while focused, and stops with the last one', () => {
    vi.useFakeTimers()
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    const a = vi.fn()
    const b = vi.fn()
    const offA = onFocusedTick(a)
    const offB = onFocusedTick(b)
    expect(setIntervalSpy).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(5000)
    expect([a.mock.calls.length, b.mock.calls.length]).toEqual([1, 1])

    hasFocus.mockReturnValue(false)
    vi.advanceTimersByTime(10_000)
    expect([a.mock.calls.length, b.mock.calls.length]).toEqual([1, 1])

    hasFocus.mockReturnValue(true)
    offA()
    vi.advanceTimersByTime(5000)
    expect([a.mock.calls.length, b.mock.calls.length]).toEqual([1, 2])

    offB()
    expect(vi.getTimerCount()).toBe(0)
  })
})
