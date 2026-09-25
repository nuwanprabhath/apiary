import { test, expect } from '@playwright/test'
import { launchApiary, importAll, type Harness, sidebarSession, clickRowAction } from './helpers'

let h: Harness

test.beforeEach(async () => {
  h = await launchApiary()
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
})

test.afterEach(async () => { await h.close() })

test('deleting a session removes it from the sidebar but leaves it importable again', async () => {
  await expect(sidebarSession(h.page, 'Fix CSV export bug')).toBeVisible()

  const row = h.page.getByTestId('session-item').filter({ hasText: 'Fix CSV export bug' })
  await row.hover()
  await clickRowAction(row, 'delete-session-button')

  await expect(h.page.getByTestId('delete-session-dialog')).toBeVisible()
  await expect(h.page.getByTestId('delete-session-dialog')).toContainText('Fix CSV export bug')
  await h.page.getByTestId('delete-session-confirm').click()

  await expect(h.page.getByTestId('delete-session-dialog')).toHaveCount(0)
  await expect(sidebarSession(h.page, 'Fix CSV export bug')).toHaveCount(0)

  // It never touched the underlying JSONL — still discoverable and re-importable.
  const discovered = await h.page.evaluate(() => window.apiary.discovered())
  expect(discovered.some((s) => s.title === 'Fix CSV export bug')).toBe(true)

  await h.page.evaluate(async () => {
    const all = await window.apiary.discovered()
    const target = all.find((s) => s.title === 'Fix CSV export bug')
    if (target) await window.apiary.importSessions([target.sessionId], [])
  })
  await h.page.getByTestId('sidebar-refresh').click()
  await expect(sidebarSession(h.page, 'Fix CSV export bug')).toBeVisible()
})

