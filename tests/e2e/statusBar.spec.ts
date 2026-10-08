import { test, expect } from '@playwright/test'
import { launchApiary, type Harness } from './helpers'

/**
 * The status bar's real wiring: main starts the Claude usage plugin and the window draws what it
 * says. It first asks whether it may read Claude Code's sign-in (nothing is read before the answer);
 * the fixture home has no sign-in, so once allowed it must say so — and, not reading the Keychain
 * for a fixture config root, must never put a permission prompt on the screen, nor send anything
 * anywhere.
 */

let h: Harness

test.beforeEach(async () => { h = await launchApiary({ settings: { plugins: { 'claude-usage': true } } }) })

test.afterEach(async () => { await h.close() })

test('asks before reading Claude Code\'s sign-in; once allowed it shows Claude usage, and the plugin has its settings under Plugins', async () => {
  const usage = h.page.getByTestId('status-item-claude-usage-usage')
  await expect(usage).toHaveText(/Claude usage: allow access\?/)
  await expect(h.page.getByTestId('status-consent')).toBeVisible()
  await expect(h.page.getByTestId('status-item-claude-usage-refresh')).toHaveCount(0)

  await h.page.getByTestId('status-consent-allow').click()
  await expect(h.page.getByTestId('status-consent')).toHaveCount(0)
  await expect(usage).toHaveText(/Claude: sign in/)
  await expect(h.page.getByTestId('status-item-claude-usage-refresh')).toBeVisible()

  await h.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('apiary:open-settings-dialog')
  })
  await h.page.getByTestId('settings-nav-plugins').click()
  await expect(h.page.getByTestId('plugin-claude-usage')).toBeVisible()
  await expect(h.page.getByTestId('plugin-claude-usage')).toContainText('Refresh every (minutes)')
})

test('declining the question turns the plugin off, and Settings shows it off', async () => {
  await expect(h.page.getByTestId('status-consent')).toBeVisible()
  await h.page.getByTestId('status-consent-deny').click()
  await expect(h.page.getByTestId('status-consent')).toHaveCount(0)
  await expect(h.page.getByTestId('status-item-claude-usage-usage')).toHaveCount(0)

  await h.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('apiary:open-settings-dialog')
  })
  await h.page.getByTestId('settings-nav-plugins').click()
  await expect(h.page.getByTestId('setting-plugin-claude-usage')).not.toBeChecked()
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
