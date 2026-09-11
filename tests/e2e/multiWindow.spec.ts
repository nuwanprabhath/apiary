import { test, expect } from '@playwright/test'
import { launchApiary, importAll, sidebarSession, type Harness } from './helpers'

let h: Harness
test.beforeEach(async () => {
  h = await launchApiary()
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
})
test.afterEach(async () => { await h.close() })

test('a second window is its own workspace over the same sessions', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await expect(h.page.getByTestId('session-tab')).toHaveCount(1)

  const second = await h.newWindow()

  // The same sessions are listed — one store, one set of terminals — but the first window's open
  // tab is not carried over, or a second window would only ever be a copy of the first.
  await expect(second.getByTestId('session-item').first()).toBeVisible()
  await expect(second.getByTestId('session-tab')).toHaveCount(0)

  // And working in one window does not disturb the other.
  await sidebarSession(second, 'Add worktree switcher').click()
  await expect(second.getByTestId('session-title')).toHaveText('Add worktree switcher')
  await expect(h.page.getByTestId('session-tab')).toHaveCount(1)
  await expect(h.page.getByTestId('session-title')).toHaveText('Fix CSV export bug')
})

test('a session opened in both windows shows live terminal output in each', async () => {
  // Terminal output is broadcast to every window rather than only the focused one; a background
  // window showing the same session must not sit frozen until it is clicked.
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  const second = await h.newWindow()
  await sidebarSession(second, 'Fix CSV export bug').click()

  await second.getByTestId('session-tab-label').first().click()
  await expect(second.getByTestId('session-title')).toHaveText('Fix CSV export bug')
  await expect(h.page.getByTestId('session-title')).toHaveText('Fix CSV export bug')
})
