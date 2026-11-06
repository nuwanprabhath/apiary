import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { bringWindowToFront, watchAppWindowPreview } from '../../src/renderer/state/appWindowsStore'

// The stores read `window.apiary` to notice a component test's new bridge; give Node one before they load.
const g = vi.hoisted(() => {
  const holder = globalThis as unknown as { window: Record<string, unknown> }
  holder.window = { apiary: {} }
  return holder
})

let preview: ReturnType<typeof vi.fn>
let raise: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.useFakeTimers()
  preview = vi.fn(async () => 'data:image/png;base64,AA')
  raise = vi.fn(async () => {})
  g.window = { apiary: { appWindowPreview: preview, appWindowRaise: raise }, setInterval, clearInterval }
})
afterEach(() => { vi.useRealTimers() })

describe('the window buttons\' commands', () => {
  it('takes a picture of a window at once and again every 1.5 s while its preview is open, then stops', async () => {
    const stop = watchAppWindowPreview(2)
    expect(preview).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(3000)
    expect(preview).toHaveBeenCalledTimes(3)
    stop()
    await vi.advanceTimersByTimeAsync(3000)
    expect(preview).toHaveBeenCalledTimes(3)
    expect(preview.mock.calls.every((c) => c[0] === 2)).toBe(true)
  })

  it('asks main to raise a window', () => {
    bringWindowToFront(3)
    expect(raise).toHaveBeenCalledExactlyOnceWith(3)
  })
})
