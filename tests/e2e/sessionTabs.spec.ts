import { test, expect } from '@playwright/test'
import { launchApiary, importAll, sidebarSession, type Harness, rowAction } from './helpers'

let h: Harness
test.beforeEach(async () => {
  h = await launchApiary()
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
})
test.afterEach(async () => { await h.close() })

test('opening a second session adds a tab rather than replacing the first', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await expect(h.page.getByTestId('session-tab')).toHaveCount(1)

  await sidebarSession(h.page, 'Add worktree switcher').click()
  await expect(h.page.getByTestId('session-tab')).toHaveCount(2)
  await expect(h.page.getByTestId('session-title')).toHaveText('Add worktree switcher')

  // Both remain open, and the first is one click away rather than needing to be reopened.
  await h.page.getByTestId('session-tab').first().getByTestId('session-tab-label').click()
  await expect(h.page.getByTestId('session-title')).toHaveText('Fix CSV export bug')
  await expect(h.page.getByTestId('session-tab')).toHaveCount(2)
})

test('reopening an already-open session activates its tab instead of duplicating it', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await sidebarSession(h.page, 'Add worktree switcher').click()
  await sidebarSession(h.page, 'Fix CSV export bug').click()

  await expect(h.page.getByTestId('session-tab')).toHaveCount(2)
  await expect(h.page.getByTestId('session-title')).toHaveText('Fix CSV export bug')
})

test('closing a tab falls back to its neighbour, and closing the last one empties the column', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await sidebarSession(h.page, 'Add worktree switcher').click()

  await h.page.getByTestId('session-tab').last().getByTestId('session-tab-close').click()
  await expect(h.page.getByTestId('session-tab')).toHaveCount(1)
  await expect(h.page.getByTestId('session-title')).toHaveText('Fix CSV export bug')

  await h.page.getByTestId('session-tab').first().getByTestId('session-tab-close').click()
  await expect(h.page.getByTestId('session-tab')).toHaveCount(0)
  await expect(h.page.getByTestId('content-empty')).toBeVisible()
})

test('the split button opens the session in a second column, with its own shell', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await expect(h.page.getByTestId('session-column')).toHaveCount(1)

  // The split button is a sibling of the row button, not a child of it (a <button> can't nest
  // another), so filter the wrapper rather than the row.
  const splitRow = h.page.locator('.session-row-wrap').filter({ hasText: 'Add worktree switcher' })
  await (await rowAction(splitRow, 'split-session-button')).click()

  await expect(h.page.getByTestId('session-column')).toHaveCount(2)
  // One tab in each column, not two in one.
  await expect(h.page.getByTestId('session-tab')).toHaveCount(2)

  // Each column carries its own shell toggle — a split gives you a second set of terminals, not
  // a second view onto one.
  await expect(h.page.getByTestId('shell-toggle')).toHaveCount(2)

  const columns = h.page.getByTestId('session-column')
  await expect(columns.first()).toContainText('Fix CSV export bug')
  await expect(columns.last()).toContainText('Add worktree switcher')
})

test('splitting again keeps adding columns — there is no cap', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  for (const title of ['Add worktree switcher', 'Repo root session']) {
    const target = h.page.locator('.session-row-wrap').filter({ hasText: title })
    await (await rowAction(target, 'split-session-button')).click()
  }
  await expect(h.page.getByTestId('session-column')).toHaveCount(3)
})

test('the shell pane stays pinned to the bottom instead of scrolling the layout away', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await h.page.getByTestId('shell-toggle').click()
  await expect(h.page.getByTestId('terminal-shell')).toBeVisible()

  // The editor area must not become a scroll container: if it does, opening the shell pushes the
  // layout down and the pane scrolls out of view instead of docking, which is what used to happen.
  const overflow = await h.page.getByTestId('content')
    .evaluate((el) => getComputedStyle(el).overflowY)
  expect(overflow).toBe('hidden')

  const viewport = h.page.viewportSize()
  const pane = await h.page.locator('.bottom-pane').boundingBox()
  expect(pane).not.toBeNull()
  if (pane !== null && viewport !== null) {
    expect(Math.abs(viewport.height - (pane.y + pane.height))).toBeLessThan(4)
  }
})
