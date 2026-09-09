import { test, expect } from '@playwright/test'
import { launchApiary, importAll, relaunchApiary, rowAction, sidebarSession, type Harness } from './helpers'

let h: Harness
test.beforeEach(async () => {
  h = await launchApiary()
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
  await expect(h.page.getByTestId('session-item')).toHaveCount(4)
})
test.afterEach(async () => { await h.close() })

/** The wrapper around one sidebar row, by the session's title — the pin button's own parent. */
function row(h: Harness, title: string) {
  return h.page.locator('.session-row-wrap').filter({ hasText: title })
}

test('pinning lifts a session to the top and unpinning puts it back', async () => {
  // Nothing pinned: no section at all, rather than an empty header taking up room.
  await expect(h.page.getByTestId('pinned-section')).toHaveCount(0)

  await (await rowAction(row(h, 'Worktree session'), 'pin-session-button')).click()

  const section = h.page.getByTestId('pinned-section')
  await expect(section).toBeVisible()
  await expect(section.getByTestId('session-item')).toHaveCount(1)
  await expect(section.getByTestId('session-item')).toContainText('Worktree session')

  // Moved, not copied: the row is gone from the folder it came from, so the sidebar never shows
  // the same session twice.
  await expect(h.page.getByTestId('session-item')).toHaveCount(4)
  await expect(sidebarSession(h.page, 'Worktree session')).toHaveCount(1)

  // The same button unpins, and the row goes back where it came from.
  await (await rowAction(section.locator('.session-row-wrap'), 'pin-session-button')).click()
  await expect(h.page.getByTestId('pinned-section')).toHaveCount(0)
  await expect(h.page.getByTestId('session-item')).toHaveCount(4)
})

test('the pinned section collapses, and both the pins and the collapse survive a relaunch', async () => {
  await (await rowAction(row(h, 'Worktree session'), 'pin-session-button')).click()
  await (await rowAction(row(h, 'Fix CSV export bug'), 'pin-session-button')).click()

  const section = h.page.getByTestId('pinned-section')
  await expect(section.getByTestId('session-item')).toHaveCount(2)
  // Most recently pinned first, so a freshly pinned session doesn't land somewhere arbitrary.
  await expect(section.getByTestId('session-item').first()).toContainText('Fix CSV export bug')

  await h.page.getByTestId('pinned-toggle').click()
  await expect(section.getByTestId('session-item')).toHaveCount(0)
  // The header itself stays, or there would be no way back.
  await expect(h.page.getByTestId('pinned-toggle')).toBeVisible()

  await relaunchApiary(h)
  await expect(h.page.getByTestId('pinned-toggle')).toBeVisible()
  await expect(h.page.getByTestId('pinned-section').getByTestId('session-item')).toHaveCount(0)

  await h.page.getByTestId('pinned-toggle').click()
  await expect(h.page.getByTestId('pinned-section').getByTestId('session-item')).toHaveCount(2)
})

test('a pinned session opens like any other, and searching narrows the pinned list too', async () => {
  await (await rowAction(row(h, 'Worktree session'), 'pin-session-button')).click()
  await h.page.getByTestId('pinned-section').getByTestId('session-item').click()
  await expect(h.page.getByTestId('session-title')).toContainText('Worktree session')

  // A pinned row that doesn't match the search would otherwise be the one row on screen that
  // ignores the search box.
  await h.page.getByTestId('search-input').fill('csv')
  await expect(h.page.getByTestId('pinned-section')).toHaveCount(0)
  await h.page.getByTestId('search-input').fill('worktree')
  await expect(h.page.getByTestId('pinned-section').getByTestId('session-item')).toHaveCount(1)
})

test("a row's age gives way to its buttons on hover", async () => {
  const target = row(h, 'Fix CSV export bug')
  // At rest: the age is what you scan the list by, and the buttons are out of the way.
  await expect(target.getByTestId('session-time')).toBeVisible()
  await expect(target.getByTestId('pin-session-button')).toBeHidden()
  await expect(target.getByTestId('split-session-button')).toBeHidden()
  await expect(target.getByTestId('delete-session-button')).toBeHidden()

  await target.hover()

  await expect(target.getByTestId('session-time')).toBeHidden()
  await expect(target.getByTestId('pin-session-button')).toBeVisible()
  await expect(target.getByTestId('split-session-button')).toBeVisible()
  await expect(target.getByTestId('delete-session-button')).toBeVisible()
})

test('removing a pinned session drops it from the pinned list as well as the tree', async () => {
  await (await rowAction(row(h, 'Worktree session'), 'pin-session-button')).click()
  await expect(h.page.getByTestId('pinned-section')).toBeVisible()

  await (await rowAction(h.page.getByTestId('pinned-section').locator('.session-row-wrap'), 'delete-session-button')).click()
  await h.page.getByTestId('delete-session-confirm').click()

  await expect(h.page.getByTestId('pinned-section')).toHaveCount(0)
  await expect(h.page.getByTestId('session-item')).toHaveCount(3)
})
