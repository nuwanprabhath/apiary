import { test, expect } from '@playwright/test'
import { launchApiary, type Harness } from './helpers'

/**
 * The Windows/Linux themed title bar against the real application menu (forced on any OS with
 * `APIARY_WINDOW_CHROME=custom`): what it draws comes from Electron's own Menu, and picking an
 * item runs that item's own click — a menu command and a role alike.
 */

let h: Harness

test.afterEach(async () => { await h.close() })

test('the custom title bar draws the real menu and runs its commands', async () => {
  h = await launchApiary({ windowChrome: 'custom' })
  await expect(h.page.getByTestId('title-bar')).toBeVisible()
  await expect(h.page.getByTestId('title-bar-title')).toHaveText('Apiary')

  await h.page.getByTestId('menu-bar-file').click()
  const file = h.page.getByTestId('menu-bar-dropdown')
  await expect(file.getByRole('menuitem', { name: /Settings/ })).toContainText(/(Ctrl|Cmd)\+,/)
  await file.getByRole('menuitem', { name: /Settings/ }).click()
  await expect(h.page.getByTestId('settings-dialog')).toBeVisible()
  await h.page.keyboard.press('Escape')
  await expect(h.page.getByTestId('settings-dialog')).toHaveCount(0)

  // A command whose effect is visible in the window: View → Toggle Sidebar.
  await expect(h.page.getByTestId('sidebar')).toBeVisible()
  await h.page.getByTestId('menu-bar-view').click()
  await h.page.getByTestId('menu-bar-dropdown').getByRole('menuitem', { name: /Toggle Sidebar/ }).click()
  await expect(h.page.getByTestId('sidebar-rail')).toBeVisible()
})

test('a Mac window keeps the system menu and gets a themed strip beside the traffic lights', async () => {
  h = await launchApiary({ windowChrome: 'mac' })
  await expect(h.page.getByTestId('title-bar')).toHaveAttribute('data-chrome', 'mac')
  await expect(h.page.getByTestId('menu-bar')).toHaveCount(0)
})

test('the system title bar leaves the OS to draw everything', async () => {
  h = await launchApiary({ windowChrome: 'system' })
  await expect(h.page.getByTestId('sidebar')).toBeVisible()
  await expect(h.page.getByTestId('title-bar')).toHaveCount(0)
})
