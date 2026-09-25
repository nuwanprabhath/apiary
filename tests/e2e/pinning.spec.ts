import { test, expect } from '@playwright/test'
import { launchApiary, importAll, relaunchApiary, clickRowAction, type Harness } from './helpers'

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

test('the pinned section collapses, and both the pins and the collapse survive a relaunch', async () => {
  await clickRowAction(row(h, 'Worktree session'), 'pin-session-button')
  await clickRowAction(row(h, 'Fix CSV export bug'), 'pin-session-button')

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

test('pinned sessions can be dragged into the order you want them in, and stay there', async () => {
  await clickRowAction(row(h, 'Fix CSV export bug'), 'pin-session-button')
  await clickRowAction(row(h, 'Add worktree switcher'), 'pin-session-button')

  const section = h.page.getByTestId('pinned-section')
  const titles = section.locator('[data-testid="session-item"] .session-title')
  // Newest pin goes to the top, so this starts as the reverse of the order they were pinned in.
  await expect(titles).toHaveText(['Add worktree switcher', 'Fix CSV export bug'])

  const rows = section.locator('[data-testid="session-item"]')
  await rows.last().dragTo(rows.first())
  await expect(titles).toHaveText(['Fix CSV export bug', 'Add worktree switcher'])

  await relaunchApiary(h)
  await expect(h.page.getByTestId('pinned-section').locator('[data-testid="session-item"] .session-title'))
    .toHaveText(['Fix CSV export bug', 'Add worktree switcher'])
})
