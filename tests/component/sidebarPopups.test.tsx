import { describe, it, expect } from 'vitest'
import { page, userEvent } from '@vitest/browser/context'
import { renderApp } from './renderApp'
import { sidebarSession, sessionRow, mouse, until } from './helpers'
import { FIXTURE_SESSIONS } from './fakeApiary'

/** The row wrapper holding a session — where its hover-only action buttons live. */
async function rowWrap(title: string): Promise<HTMLElement> {
  const row = await sessionRow(title)
  return row.closest<HTMLElement>('.session-row-wrap') ?? row
}

/**
 * The sidebar's hover popups: that they appear, and — the part that kept going wrong — that they
 * go away again.
 *
 * A hover popup is opened by one event and closed by another, and the closing one is the fragile
 * half. `useHoverCard` deliberately swallows a `mouseleave` when it believes the row moved rather
 * than the pointer, which is right for a reflowing sidebar and catastrophic when the belief is
 * wrong: the only event that would have dismissed the popup is gone, and it sits on screen
 * ignoring every click. These tests are about the dismissal, not the appearance.
 */
describe('sidebarPopups', () => {
  it('the layout picker closes when the pointer moves away from it', async () => {
    await renderApp()
    const wrap = await rowWrap('Fix CSV export bug')
    await userEvent.hover(wrap)
    const button = wrap.querySelector('[data-testid="split-session-button"]') as HTMLElement
    await userEvent.hover(button)
    await until(() => page.getByTestId('layout-picker').elements().length === 1)

    // Somewhere that is neither the button nor the picker. Moving in steps so intermediate
    // mousemove events fire the way they do for a real pointer.
    await mouse.move(900, 700, 10)
    await until(() => page.getByTestId('layout-picker').elements().length === 0)
    expect(page.getByTestId('layout-picker').elements()).toHaveLength(0)
  })

  it('the row hover card gives way to the layout picker rather than overlapping it', async () => {
    await renderApp()
    const wrap = await rowWrap('Fix CSV export bug')
    await userEvent.hover(wrap)
    await until(() => page.getByTestId('session-hover-card').elements().length === 1)

    const button = wrap.querySelector('[data-testid="split-session-button"]') as HTMLElement
    await userEvent.hover(button)
    await until(() => page.getByTestId('layout-picker').elements().length === 1)
    expect(page.getByTestId('session-hover-card').elements()).toHaveLength(0)
  })

  it('the hover card closes when the pointer moves off the row', async () => {
    await renderApp()
    await userEvent.hover(sidebarSession('Fix CSV export bug'))
    await until(() => page.getByTestId('session-hover-card').elements().length === 1)

    await mouse.move(900, 700, 10)
    await until(() => page.getByTestId('session-hover-card').elements().length === 0)
    expect(page.getByTestId('session-hover-card').elements()).toHaveLength(0)
  })

  it('scrolling under a still pointer leaves no trail of hover cards', async () => {
    // A sidebar long enough to scroll. The default fixture has four sessions and no overflow, so
    // the wheel does nothing at all and the test passes without ever reaching the bug.
    await renderApp({
      sessions: [...FIXTURE_SESSIONS, ...Array.from({ length: 60 }, (_, i) => ({
        sessionId: `5c001100-0000-4000-8000-${String(i).padStart(12, '0')}`,
        title: `Scrollable session number ${String(i)}`,
        projectPath: '/fixture/work-a',
      }))],
    })

    // Scrolling drags rows past a pointer that never moves. Every row that passes under it fires
    // `mouseenter`, and every one of those rows has also *moved* by the time its `mouseleave`
    // arrives — which is precisely the condition `useHoverCard` reads as "the row moved, the
    // pointer did not" and swallows. So each card opens and none of them can close, and the
    // sidebar ends up wearing a stack of them.
    //
    // One card surviving a scroll would be defensible. Several at once is the bug.
    const row = await sessionRow('Scrollable session number 5')
    await userEvent.hover(row)
    const r = row.getBoundingClientRect()
    const cx = r.x + r.width / 2
    const cy = r.y + r.height / 2

    // Back to the top, so the scroll below has the whole list to travel through and drags a long
    // run of rows under the pointer. Starting from wherever `hover()` happened to leave it reaches
    // the end of the list after a notch or two and never produces enough boundary events to stack
    // anything up — which is how an earlier version of this test passed against the bug.
    const list = page.getByTestId('sidebar-list').element()
    list.scrollTop = 0
    list.dispatchEvent(new Event('scroll', { bubbles: true }))
    // Lets the scroll-reset's own re-render settle before the pointer starts moving, so the drag
    // below isn't itself the thing racing a pending re-render.
    await new Promise((resolve) => setTimeout(resolve, 100))
    await mouse.move(cx, cy)

    // Scroll with the pointer over the list. The 1px drift stands in for a hand resting on a
    // trackpad: it is what makes Chromium recompute which row is underneath, dispatching the
    // boundary events that arm each row's card in turn. Sampling between notches catches the
    // overlap, where the card being left has not closed yet and the next has already opened.
    let worst = 0
    for (let i = 0; i < 12; i++) {
      list.scrollTop += 90
      list.dispatchEvent(new Event('scroll', { bubbles: true }))
      await mouse.move(cx + (i % 2), cy)
      // Sampling the hover-card count between wheel notches at a fixed interval is the mechanism
      // this test uses to catch the overlap window; there is no single condition to poll for.
      await new Promise((resolve) => setTimeout(resolve, 60))
      worst = Math.max(worst, page.getByTestId('session-hover-card').elements().length)
    }
    expect(worst, 'hover cards stacked up during a scroll').toBeLessThanOrEqual(1)

    // And the suppression is a debounce, not an off switch: once the list stops, hovering a row
    // still produces its card. Named rather than inferred from where the pointer happened to land —
    // after this much scrolling that point may be past the end of the list entirely.
    await userEvent.hover(await sessionRow('Scrollable session number 40'))
    await until(() => page.getByTestId('session-hover-card').elements().length === 1)
  })

  it('the layout picker opens beside its button, not in the window corner', async () => {
    // The reported sighting was a picker parked at the top-left of the window, nowhere near the
    // button that opened it. A detached or hidden element returns an all-zero rect from
    // `getBoundingClientRect`, and the placement maths clamps that to the 8px margin — the corner.
    // Anchoring is also what makes the popup reachable: it has to sit where the pointer can travel
    // to it without crossing the rows underneath.
    await renderApp()
    const wrap = await rowWrap('Fix CSV export bug')
    await userEvent.hover(wrap)
    const button = wrap.querySelector('[data-testid="split-session-button"]') as HTMLElement
    await userEvent.hover(button)
    await until(() => page.getByTestId('layout-picker').elements().length === 1)

    const anchor = button.getBoundingClientRect()
    const pickerBox = page.getByTestId('layout-picker').element().getBoundingClientRect()

    // Beside the button, not below it: a picker directly underneath means the pointer crosses the
    // next session row on its way there, and that row's own hover card steals the gesture.
    expect(pickerBox.x).toBeGreaterThanOrEqual(anchor.x + anchor.width - 1)
    // Vertically aligned with the button rather than flung to the top of the screen.
    expect(Math.abs(pickerBox.y - anchor.y)).toBeLessThan(200)
  })

  it('the hover card sits beside the list, so the next row can still be seen and hovered', async () => {
    // Reported: the card opened below its row and covered the next few sessions, so you could
    // neither read them nor move the pointer onto the next one without first backing out.
    await renderApp()
    const wrap = await rowWrap('Fix CSV export bug')
    await userEvent.hover(sidebarSession('Fix CSV export bug'))
    await until(() => page.getByTestId('session-hover-card').elements().length === 1)

    const rowBox = wrap.getBoundingClientRect()
    const cardBox = page.getByTestId('session-hover-card').element().getBoundingClientRect()
    // Out past the row's right-hand edge: nothing in the list is underneath it.
    expect(cardBox.x).toBeGreaterThanOrEqual(rowBox.x + rowBox.width)

    // And the next session is reachable straight down, opening its own card in place of this one.
    await userEvent.hover(sidebarSession('Add worktree switcher'))
    await until(() => page.getByTestId('session-hover-card').elements().length === 1)
    await expect.element(page.getByTestId('session-hover-card')).toHaveTextContent('Add worktree switcher')
  })

  it('the pointer can travel from a row to its card and use it', async () => {
    // Beside the row means a horizontal move reaches the card; it must survive the crossing.
    await renderApp()
    await userEvent.hover(sidebarSession('Fix CSV export bug'))
    await until(() => page.getByTestId('session-hover-card').elements().length === 1)

    const cardBox = page.getByTestId('session-hover-card').element().getBoundingClientRect()
    await mouse.move(cardBox.x + 20, cardBox.y + 12, 12)
    // Proving the card survives the crossing rather than closing a moment after the move
    // completes; there is no later condition to assert on other than re-checking after time passes.
    await new Promise((resolve) => setTimeout(resolve, 400))
    await expect.element(page.getByTestId('session-hover-card')).toBeVisible()
    await expect.element(page.getByTestId('session-hover-card')).toHaveTextContent('Fix CSV export bug')
  })

  it('the layout picker survives a slow trip across the row to reach it', async () => {
    // Reported: moving from the layout button to its picker, the pointer passed over the row's
    // other buttons, and the picker vanished unless the move was very fast. Paused in between for
    // longer than the grace period, it must still be there.
    await renderApp()
    const wrap = await rowWrap('Fix CSV export bug')
    await userEvent.hover(wrap)
    const button = wrap.querySelector('[data-testid="split-session-button"]') as HTMLElement
    await userEvent.hover(button)
    await until(() => page.getByTestId('layout-picker').elements().length === 1)

    const b = button.getBoundingClientRect()
    const p = page.getByTestId('layout-picker').element().getBoundingClientRect()
    const r = wrap.getBoundingClientRect()
    // A point on the row, past the button, short of the picker.
    const midX = Math.min(b.x + b.width + 2, p.x - 1)
    await mouse.move(midX, b.y + b.height / 2, 8)
    // Pausing mid-crossing longer than the grace period is the point of this test; there is no
    // condition to poll for other than re-checking after the pause.
    await new Promise((resolve) => setTimeout(resolve, 500))
    await expect.element(page.getByTestId('layout-picker')).toBeVisible()

    await mouse.move(p.x + p.width / 2, p.y + p.height / 2, 8)
    await expect.element(page.getByTestId('layout-picker')).toBeVisible()
    await mouse.move(r.x + r.width / 2, r.y + 300, 8)
    await until(() => page.getByTestId('layout-picker').elements().length === 0)
  })
})
