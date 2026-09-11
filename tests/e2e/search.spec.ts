import { test, expect } from '@playwright/test'
import { launchApiary, importAll, type Harness } from './helpers'

/**
 * Opens Settings the way the other settings tests do.
 *
 * Not via the keyboard accelerator: that is handled by Electron's native menu, which never sees
 * keys sent to the page — pressing it here does nothing at all.
 */
async function openSettings(h: Harness): Promise<void> {
  await h.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('apiary:open-settings-dialog')
  })
  await expect(h.page.getByTestId('settings-dialog')).toBeVisible()
}

let h: Harness
test.beforeEach(async () => {
  h = await launchApiary()
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
})
test.afterEach(async () => { await h.close() })

const search = (h: Harness) => h.page.getByTestId('search-input')

test('finds a session by something said in it, not just by its title', async () => {
  // "empty" appears in this session's first message and in no session's title — so a hit can only
  // have come from the conversation itself.
  await search(h).fill('empty')

  const items = h.page.getByTestId('session-item')
  await expect(items).toHaveCount(1)
  await expect(items).toContainText('Fix CSV export bug')
})

test('turning off content search falls back to titles alone', async () => {
  await search(h).fill('empty')
  await expect(h.page.getByTestId('session-item')).toHaveCount(1)

  await search(h).fill('')
  await openSettings(h)
  await h.page.getByTestId('settings-nav-search').click()
  await h.page.getByTestId('setting-search-chat-content').uncheck()
  await h.page.getByTestId('settings-save').click()

  await search(h).fill('empty')
  await expect(h.page.getByTestId('sidebar-no-matches')).toBeVisible()

  // The title search it falls back to still works, so this is narrower, not broken.
  await search(h).fill('CSV')
  await expect(h.page.getByTestId('session-item')).toHaveCount(1)
})

test('settings reports how much has been indexed, and can rebuild it', async () => {
  await openSettings(h)
  await h.page.getByTestId('settings-nav-search').click()

  // The fixture has several sessions, all imported above; the exact number is the fixture's
  // business, so this asserts only that indexing has actually happened.
  await expect(h.page.getByTestId('search-index-status')).not.toContainText('0 sessions indexed')

  await h.page.getByTestId('search-rebuild').click()
  await expect(h.page.getByTestId('search-rebuild')).toBeEnabled({ timeout: 30000 })
  await expect(h.page.getByTestId('search-index-status')).not.toContainText('0 sessions indexed')

  await h.page.getByTestId('settings-cancel').click()
  // And search still works against the rebuilt index.
  await search(h).fill('empty')
  await expect(h.page.getByTestId('session-item')).toHaveCount(1)
})
