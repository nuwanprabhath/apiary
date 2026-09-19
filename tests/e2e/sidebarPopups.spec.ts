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
