import { test, expect } from '@playwright/test'
import { launchApiary, importAll, type Harness, sidebarSession } from './helpers'

/**
 * The window grows to fit its panes: three columns in a 900 px window used to run the last pane off
 * the edge, where nothing could reach it. Real wiring: the renderer reports what its panes need,
 * main raises the window's minimum and widens it.
 */

let h: Harness

test.afterEach(async () => { await h.close() })

const windowBounds = async (): Promise<{ width: number; minWidth: number }> => h.app.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows()[0]
  return { width: win.getBounds().width, minWidth: win.getMinimumSize()[0] }
})

test('picking three columns in a narrow window widens it so every pane fits, and it cannot be narrowed past them', async () => {
  h = await launchApiary()
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
  await h.app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.setBounds({ ...win.getBounds(), width: 900 })
  })
  await expect.poll(async () => (await windowBounds()).width).toBe(900)

  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await h.page.getByTestId('window-layout-button').click()
  await h.page.getByTestId('layout-option-thirds-h').first().click()
  await expect(h.page.getByTestId('content')).toHaveAttribute('data-preset', 'thirds-h')
  await h.page.keyboard.press('Escape')

  // Wider than 900, and every pane's right edge inside the page.
  await expect.poll(async () => (await windowBounds()).width).toBeGreaterThan(900)
  const { width, minWidth } = await windowBounds()
  expect(minWidth).toBe(width)
  const pageWidth = await h.page.evaluate(() => window.innerWidth)
  for (const box of await h.page.getByTestId('session-column').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right))) {
    expect(box).toBeLessThanOrEqual(pageWidth)
  }
})
