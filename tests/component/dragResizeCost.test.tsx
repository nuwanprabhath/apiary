/**
 * UI-6: dragging the sidebar resizer used to call `setUi` on every `mousemove`, which re-rendered
 * the whole App (every sidebar row, every pane) and wrote to `localStorage` twice per pixel the
 * pointer crossed. The live width now goes straight onto the grid element's style as a CSS custom
 * property, and React only hears about it once, on `mouseup`.
 *
 * The `mouseup` commit is flushed to `localStorage` immediately (`flushUiSave` in App.tsx),
 * bypassing the trailing debounce every other `ui` write goes through. That is deliberate, not an
 * oversight: an e2e spec drags a resizer and immediately relaunches the app to check the width
 * survived, with nothing in between to wait out a 250ms debounce, and the very first version of
 * this fix lost the drag on exactly that path — a relaunch inside the debounce window saw the
 * pre-drag size. `tests/e2e/sidebar.spec.ts` and `terminal.spec.ts` cover the persisted-across-a-
 * relaunch behaviour directly; this test covers the *count*, at the layer that can see it cheaply.
 *
 * Measured the same way the review suggests measuring a fetch count on the fake: by counting a
 * real, observable side effect (`localStorage.setItem`) across a drag gesture with several
 * `mousemove` steps, the way a real drag actually arrives.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { page } from 'vitest/browser'
import { renderApp } from './renderApp'
import { box, mouse, settled, stays } from './helpers'

describe('sidebar drag cost (UI-6)', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('a multi-step drag writes to localStorage once at the end, not once per mousemove', async () => {
    await renderApp()
    const resizer = page.getByTestId('sidebar-resizer')
    const r = box(resizer)

    let setItemCalls = 0
    // eslint-disable-next-line @typescript-eslint/unbound-method -- captured only to `.call(this)` it back below, never invoked unbound
    const realSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      setItemCalls++
      return realSetItem.call(this, k, v)
    })
    // Let the app's own mount-time saves finish before measuring (quiet for ten frames), so only
    // the drag's own writes are counted below.
    await settled(() => String(setItemCalls), 10)
    setItemCalls = 0

    await mouse.move(r.x + r.width / 2, r.y + r.height / 2)
    await mouse.down()
    // A real drag arrives as many small steps, not one jump — this is what made the pre-fix cost
    // scale with distance dragged rather than with "a drag happened".
    await mouse.move(r.x + r.width / 2 + 80, r.y + r.height / 2, 20)
    await mouse.up()

    // `mouseup` flushes immediately — exactly one `saveUiState` call (it writes two localStorage
    // keys) for the whole gesture, where the pre-fix code measured 40 (2 keys × the 20 mousemove
    // events this drag produced) and made every one of them wait on nothing.
    expect(setItemCalls).toBe(2)

    // Waiting past the ordinary 250ms debounce changes nothing further: the drag's own commit was
    // never subject to it.
    await stays(() => setItemCalls === 2, 350, 'the drag to cost no further writes')
  })

  it('the live width is not committed to ui state (and so not re-rendered) until the drag ends', async () => {
    await renderApp()
    const resizer = page.getByTestId('sidebar-resizer')
    const r = box(resizer)
    const layout = document.querySelector('.layout') as HTMLElement
    const widthBefore = box(page.getByTestId('sidebar')).width

    await mouse.move(r.x + r.width / 2, r.y + r.height / 2)
    await mouse.down()
    await mouse.move(r.x + r.width / 2 + 80, r.y + r.height / 2, 10)

    // Mid-drag: the grid has visibly resized (the CSS custom property), but nothing has been
    // committed to React state that a mid-drag snapshot of `ui.sidebarWidth` would reveal — the
    // property live on the element is the only evidence of the drag in progress.
    expect(layout.style.getPropertyValue('--drag-sidebar-width')).not.toBe('')
    expect(box(page.getByTestId('sidebar')).width).toBeGreaterThan(widthBefore + 40)

    await mouse.up()
    expect(layout.style.getPropertyValue('--drag-sidebar-width')).toBe('')
  })
})
