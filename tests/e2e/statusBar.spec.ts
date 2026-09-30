import { test, expect } from '@playwright/test'
import { launchApiary, type Harness } from './helpers'

/**
 * The status bar's real wiring: main starts the Claude usage plugin and the window draws what it
 * says. The fixture home has no Claude sign-in, so the plugin must say so — and, not reading the
 * Keychain for a fixture config root, must never put a permission prompt on the screen, nor send
 * anything anywhere.
 */

let h: Harness

test.beforeEach(async () => { h = await launchApiary() })

test.afterEach(async () => { await h.close() })

test('shows Claude usage in the status bar, and the plugin has its settings under Plugins', async () => {
  await expect(h.page.getByTestId('status-item-claude-usage-usage')).toHaveText(/Claude: sign in/)
  await expect(h.page.getByTestId('status-item-claude-usage-refresh')).toBeVisible()

  await h.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('apiary:open-settings-dialog')
  })
  await h.page.getByTestId('settings-nav-plugins').click()
  await expect(h.page.getByTestId('plugin-claude-usage')).toBeVisible()
  await expect(h.page.getByTestId('plugin-claude-usage')).toContainText('Refresh every (minutes)')
})

test('the status bar runs the whole width of the window along its bottom edge, under the sidebar too', async () => {
  await expect(h.page.getByTestId('status-bar')).toBeVisible()
  const box = await h.page.evaluate(() => {
    const bar = document.querySelector('[data-testid="status-bar"]')!.getBoundingClientRect()
    const sidebar = document.querySelector('[data-testid="sidebar"]')!.getBoundingClientRect()
    return { left: bar.left, right: bar.right, bottom: bar.bottom, top: bar.top, sidebarBottom: sidebar.bottom, width: window.innerWidth, height: window.innerHeight }
  })
  expect(box.left).toBe(0)
  expect(box.right).toBe(box.width)
  expect(Math.abs(box.bottom - box.height)).toBeLessThanOrEqual(1)
  expect(box.sidebarBottom).toBeLessThanOrEqual(box.top)
})
