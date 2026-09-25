import { test, expect } from '@playwright/test'
import { launchApiary, importAll, sidebarSession, type Harness } from './helpers'
import type { Locator } from '@playwright/test'

/** The row wrapper holding a session — where its hover-only action buttons live. */
function rowWrap(row: Locator): Locator {
  return row.locator('xpath=ancestor-or-self::div[contains(@class,"session-row-wrap")]')
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
let h: Harness
test.beforeEach(async () => {
  h = await launchApiary()
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
})
test.afterEach(async () => { await h.close() })

test('the layout picker closes when the pointer moves away from it', async () => {
  const wrap = rowWrap(sidebarSession(h.page, 'Fix CSV export bug'))
  await wrap.hover()
  await wrap.getByTestId('split-session-button').hover()
  await expect(h.page.getByTestId('layout-picker')).toBeVisible()

  // Somewhere that is neither the button nor the picker. Moving in steps so intermediate
  // mousemove events fire the way they do for a real pointer.
  await h.page.mouse.move(900, 700, { steps: 10 })
  await expect(h.page.getByTestId('layout-picker')).toHaveCount(0)
})

test('the layout picker still closes after the sidebar reflows under it', async () => {
  // The reported bug, and the case a plain dismissal test cannot reach. `useHoverCard` swallows a
  // `mouseleave` whenever the anchor's rect has changed since the pointer arrived, on the theory
  // that the row moved rather than the pointer. When that theory is wrong the popup is stranded:
  // the one event that would have closed it has been eaten, and it sits in the corner of the
  // window ignoring clicks on the panes, the terminal and the sidebar alike.
  //
  // The reflow has to be one the row *survives* — a row that unmounts takes its picker with it and
  // proves nothing. The Active section growing is exactly that, and it is the reflow the
  // swallowing was introduced for: it updates on its own schedule, with the pointer held still.
  const wrap = rowWrap(sidebarSession(h.page, 'Fix CSV export bug'))
  await wrap.hover()
  await wrap.getByTestId('split-session-button').hover()
  await expect(h.page.getByTestId('layout-picker')).toBeVisible()

  const before = await wrap.boundingBox()

  // A session opened in another window adds a row to this window's Active section, pushing the
  // tree — and the row the picker is anchored to — down, while the pointer never moves.
  const second = await h.newWindow()
  await second.getByTestId('sidebar-refresh').click()
  await sidebarSession(second, 'Add worktree switcher').click()
  await expect.poll(async () => (await wrap.boundingBox())?.y ?? 0)
    .not.toBe(before?.y ?? 0)

  await h.page.bringToFront()
  await h.page.mouse.move(900, 700, { steps: 10 })
  await expect(h.page.getByTestId('layout-picker')).toHaveCount(0)
})

test('the row hover card gives way to the layout picker rather than overlapping it', async () => {
  const wrap = rowWrap(sidebarSession(h.page, 'Fix CSV export bug'))
  await wrap.hover()
  await expect(h.page.getByTestId('session-hover-card')).toBeVisible()

  await wrap.getByTestId('split-session-button').hover()
  await expect(h.page.getByTestId('layout-picker')).toBeVisible()
  await expect(h.page.getByTestId('session-hover-card')).toHaveCount(0)
})

test('the hover card closes when the pointer moves off the row', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').hover()
  await expect(h.page.getByTestId('session-hover-card')).toBeVisible()

  await h.page.mouse.move(900, 700, { steps: 10 })
  await expect(h.page.getByTestId('session-hover-card')).toHaveCount(0)
})

test('scrolling under a still pointer leaves no trail of hover cards', async () => {
  // A sidebar long enough to scroll. The default fixture has four sessions and no overflow, so
  // the wheel does nothing at all and the test passes without ever reaching the bug.
  await h.close()
  h = await launchApiary({
    extraSessions: Array.from({ length: 60 }, (_, i) => ({
      slug: `-scroll-${String(i)}`,
      sessionId: `5c0011${String(i).padStart(2, '0')}-0000-4000-8000-${String(i).padStart(12, '0')}`,
      title: `Scrollable session number ${String(i)}`,
      firstPrompt: `work item ${String(i)}`,
    })),
  })
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()

  // Scrolling drags rows past a pointer that never moves. Every row that passes under it fires
  // `mouseenter` and arms a card, and every one of those rows has also *moved* by the time its
  // `mouseleave` arrives — which is precisely the condition `useHoverCard` reads as "the row
  // moved, the pointer did not" and swallows. So each card opens and none of them can close, and
  // the sidebar ends up wearing a stack of them.
  //
  // One card surviving a scroll would be defensible. Several at once is the bug.
  const row = sidebarSession(h.page, 'Scrollable session number 5')
  await row.hover()
  const box = await row.boundingBox()
  if (box === null) throw new Error('the row being scrolled past has no box')
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2

  // Back to the top, so the scroll below has the whole list to travel through and drags a long
  // run of rows under the pointer. Starting from wherever `hover()` happened to leave it reaches
  // the end of the list after a notch or two and never produces enough boundary events to stack
  // anything up — which is how an earlier version of this test passed against the bug.
  await h.page.getByTestId('sidebar-list').evaluate((e) => { e.scrollTop = 0 })
  await h.page.waitForTimeout(100)
  await h.page.mouse.move(cx, cy)

  // Scroll with the pointer over the list. The 1px drift stands in for a hand resting on a
  // trackpad: it is what makes Chromium recompute which row is underneath, dispatching the
  // boundary events that arm each row's card in turn. Sampling between notches catches the
  // overlap, where the card being left has not closed yet and the next has already opened.
  let worst = 0
  for (let i = 0; i < 12; i++) {
    await h.page.mouse.wheel(0, 90)
    await h.page.mouse.move(cx + (i % 2), cy)
    await h.page.waitForTimeout(60)
    worst = Math.max(worst, await h.page.getByTestId('session-hover-card').count())
  }
  expect(worst, 'hover cards stacked up during a scroll').toBeLessThanOrEqual(1)

  // And the suppression is a debounce, not an off switch: once the list stops, hovering a row
  // still produces its card. Named rather than inferred from where the pointer happened to land —
  // after this much scrolling that point may be past the end of the list entirely.
  await sidebarSession(h.page, 'Scrollable session number 40').hover()
  await expect(h.page.getByTestId('session-hover-card')).toBeVisible()
})

test('the layout picker opens beside its button, not in the window corner', async () => {
  // The reported sighting was a picker parked at the top-left of the window, nowhere near the
  // button that opened it. A detached or hidden element returns an all-zero rect from
  // `getBoundingClientRect`, and the placement maths clamps that to the 8px margin — the corner.
  // Anchoring is also what makes the popup reachable: it has to sit where the pointer can travel
  // to it without crossing the rows underneath.
  const wrap = rowWrap(sidebarSession(h.page, 'Fix CSV export bug'))
  await wrap.hover()
  const button = wrap.getByTestId('split-session-button')
  await button.hover()
  const picker = h.page.getByTestId('layout-picker')
  await expect(picker).toBeVisible()

  const anchor = await button.boundingBox()
  const box = await picker.boundingBox()
  if (anchor === null || box === null) throw new Error('picker or its anchor has no box')

  // Beside the button, not below it: a picker directly underneath means the pointer crosses the
  // next session row on its way there, and that row's own hover card steals the gesture.
  expect(box.x).toBeGreaterThanOrEqual(anchor.x + anchor.width - 1)
  // Vertically aligned with the button rather than flung to the top of the screen.
  expect(Math.abs(box.y - anchor.y)).toBeLessThan(200)
})

test('the hover card sits beside the list, so the next row can still be seen and hovered', async () => {
  // Reported: the card opened below its row and covered the next few sessions, so you could
  // neither read them nor move the pointer onto the next one without first backing out.
  const first = sidebarSession(h.page, 'Fix CSV export bug')
  await first.hover()
  const card = h.page.getByTestId('session-hover-card')
  await expect(card).toBeVisible()

  const rowBox = await rowWrap(first).boundingBox()
  const cardBox = await card.boundingBox()
  if (rowBox === null || cardBox === null) throw new Error('row or card has no box')
  // Out past the row's right-hand edge: nothing in the list is underneath it.
  expect(cardBox.x).toBeGreaterThanOrEqual(rowBox.x + rowBox.width)

  // And the next session is reachable straight down, opening its own card in place of this one.
  const next = sidebarSession(h.page, 'Add worktree switcher')
  await next.hover()
  await expect(card).toHaveCount(1)
  await expect(card).toContainText('Add worktree switcher')
})

test('the pointer can travel from a row to its card and use it', async () => {
  // Beside the row means a horizontal move reaches the card; it must survive the crossing.
  const row = sidebarSession(h.page, 'Fix CSV export bug')
  await row.hover()
  const card = h.page.getByTestId('session-hover-card')
  await expect(card).toBeVisible()

  const cardBox = await card.boundingBox()
  if (cardBox === null) throw new Error('card has no box')
  await h.page.mouse.move(cardBox.x + 20, cardBox.y + 12, { steps: 12 })
  await h.page.waitForTimeout(400)
  await expect(card).toBeVisible()
  await expect(card).toContainText('Fix CSV export bug')
})

test('the layout picker survives a slow trip across the row to reach it', async () => {
  // Reported: moving from the layout button to its picker, the pointer passed over the row's other
  // buttons, and the picker vanished unless the move was very fast. Paused in between for longer
  // than the grace period, it must still be there.
  const wrap = rowWrap(sidebarSession(h.page, 'Fix CSV export bug'))
  await wrap.hover()
  const button = wrap.getByTestId('split-session-button')
  await button.hover()
  const picker = h.page.getByTestId('layout-picker')
  await expect(picker).toBeVisible()

  const b = await button.boundingBox()
  const p = await picker.boundingBox()
  const r = await wrap.boundingBox()
  if (b === null || p === null || r === null) throw new Error('missing box')
  // A point on the row, past the button, short of the picker.
  const midX = Math.min(b.x + b.width + 2, p.x - 1)
  await h.page.mouse.move(midX, b.y + b.height / 2, { steps: 8 })
  await h.page.waitForTimeout(500)
  await expect(picker).toBeVisible()

  await h.page.mouse.move(p.x + p.width / 2, p.y + p.height / 2, { steps: 8 })
  await expect(picker).toBeVisible()
  await h.page.mouse.move(r.x + r.width / 2, r.y + 300, { steps: 8 })
  await expect(picker).toHaveCount(0)
})
