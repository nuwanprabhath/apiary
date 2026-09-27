/**
 * UI-7: `useHoverCard` used to have every mounted instance schedule its own settle timer on every
 * scroll event, and each of those timers read `getBoundingClientRect()` on its own row once it
 * fired — O(rows) timers and layout reads per wheel notch. The fix shares one debounce and asks
 * the DOM once, via `elementFromPoint`, which row the pointer ended up over.
 *
 * Measured here the same way the review suggests measuring a fetch count on the fake: by counting
 * a real side effect (`getBoundingClientRect` on a row wrapper) that only happens when a row's
 * settle logic actually runs, across a sidebar with enough rows for "O(rows)" to be visible.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { page } from 'vitest/browser'
import { renderApp } from './renderApp'
import type { FakeSession } from './fakeApiary'

const SESSION_COUNT = 40

function manySessions(): FakeSession[] {
  return Array.from({ length: SESSION_COUNT }, (_, i) => ({
    sessionId: `bulk-${i}`,
    title: `Bulk session ${i}`,
    projectPath: '/fixture/repo-c',
  }))
}

describe('useHoverCard scroll cost (UI-7)', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('a scroll settling over no row costs O(1) rect reads, not one per mounted row', async () => {
    await renderApp({ sessions: manySessions() })
    const list = page.getByTestId('sidebar-list').element() as HTMLElement
    expect(list.querySelectorAll('.session-row-wrap').length).toBeGreaterThanOrEqual(SESSION_COUNT)

    // Keep the pointer off every row (top-left corner, before the sidebar) so nothing is armed or
    // open when the scroll fires, and any post-scroll reopen has nothing under it to reopen for.
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 0, clientY: 0 }))

    let wrapRectReads = 0
    // eslint-disable-next-line @typescript-eslint/unbound-method -- captured only to `.call(this)` it back below, never invoked unbound
    const realRect = Element.prototype.getBoundingClientRect
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.classList.contains('session-row-wrap')) wrapRectReads++
      return realRect.call(this)
    })

    list.dispatchEvent(new Event('scroll'))
    // Past SCROLL_QUIET_MS (250) + HOVER_DELAY_MS (350) — long enough for the shared settle check
    // (old code: every mounted row's own settle timer) to have fired.
    await new Promise((r) => { setTimeout(r, 700) })

    // Measured against the pre-UI-7 code (each of the 40 rows' `useHoverCard` scheduling its own
    // settle timer and reading its own rect): 40 reads for this scenario. After the fix: 0 — the
    // single shared check finds nothing under the pointer and never reaches a row's rect at all.
    expect(wrapRectReads).toBe(0)
  })
})
