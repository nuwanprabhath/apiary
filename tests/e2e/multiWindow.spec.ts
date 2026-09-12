import { test, expect } from '@playwright/test'
import { launchApiary, importAll, sidebarSession, clickRowAction, type Harness } from './helpers'

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

// The reported bug: a second window opened with an empty sidebar arrangement — no pinned section
// and no groups — because the whole of the UI state was keyed per window. Tabs and column widths
// belong to a window; how the user has organised their sessions does not.
test('a second window has the same pinned sessions and groups as the first', async () => {
  await clickRowAction(sidebarSession(h.page, 'Fix CSV export bug'), 'pin-session-button')
  await expect(h.page.getByTestId('pinned-section')).toBeVisible()

  const second = await h.newWindow()

  await expect(second.getByTestId('pinned-section')).toBeVisible()
  await expect(second.getByTestId('pinned-section').getByTestId('session-item'))
    .toContainText('Fix CSV export bug')
})

test('pinning in one window shows up in the other without either being restarted', async () => {
  const second = await h.newWindow()
  await expect(second.getByTestId('pinned-section')).toHaveCount(0)

  await clickRowAction(sidebarSession(h.page, 'Fix CSV export bug'), 'pin-session-button')

  // Windows share an origin, so the second one hears the change rather than waiting for a relaunch.
  await expect(second.getByTestId('pinned-section')).toBeVisible()
  await expect(second.getByTestId('pinned-section').getByTestId('session-item'))
    .toContainText('Fix CSV export bug')
})

test('each window still keeps its own tabs and its own sidebar width', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  const second = await h.newWindow()
  await sidebarSession(second, 'Add worktree switcher').click()

  await expect(h.page.getByTestId('session-tab')).toHaveCount(1)
  await expect(second.getByTestId('session-tab')).toHaveCount(1)
  await expect(h.page.getByTestId('session-title')).toHaveText('Fix CSV export bug')
  await expect(second.getByTestId('session-title')).toHaveText('Add worktree switcher')
})
