import { test, expect } from '@playwright/test'
import { launchApiary, importAll, relaunchApiary, type Harness, sidebarSession } from './helpers'

let h: Harness

test.beforeEach(async () => {
  h = await launchApiary()
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
  await sidebarSession(h.page, 'Fix CSV export bug').click()
})

test.afterEach(async () => { await h.close() })

test('renaming a session updates the header and the sidebar row, and survives a relaunch', async () => {
  await expect(h.page.getByTestId('session-title')).toHaveText('Fix CSV export bug')

  await h.page.getByTestId('session-title-edit').click()
  const input = h.page.getByTestId('session-title-input')
  await expect(input).toBeFocused()
  await input.fill('My renamed session')
  await input.press('Enter')

  // The input is gone and the header reflects the new title immediately.
  await expect(h.page.getByTestId('session-title-input')).toHaveCount(0)
  await expect(h.page.getByTestId('session-title')).toHaveText('My renamed session')

  // The sidebar row picks it up too, without a manual refresh (the rename IPC handler pushes
  // the same "tree changed" signal the filesystem watcher uses). Scoped to the sidebar row
  // itself — the header above also now contains this text.
  await expect(h.page.getByTestId('session-item').filter({ hasText: 'My renamed session' })).toBeVisible()
  await expect(h.page.getByTestId('session-item').filter({ hasText: 'Fix CSV export bug' })).toHaveCount(0)

  // The rename is a real store write, not just optimistic renderer state — it survives a relaunch.
  await relaunchApiary(h)
  await expect(h.page.getByTestId('session-title')).toHaveText('My renamed session')
})

