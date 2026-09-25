import { test, expect, type Locator } from '@playwright/test'
import { launchApiary, importAll, sidebarSession, type Harness } from './helpers'

/**
 * Arranging sessions into a layout of up to four panes, from a hover picker — the macOS
 * window-tiling gesture, applied to panes inside one window.
 */

let h: Harness

test.beforeEach(async () => {
  h = await launchApiary({ secondWorktree: true })
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
})

test.afterEach(async () => { await h.close() })

const panes = (): Locator => h.page.getByTestId('session-column')

async function openPickerOn(button: Locator, hoverFirst?: Locator): Promise<Locator> {
  await expect(async () => {
    if (hoverFirst !== undefined) await hoverFirst.hover({ timeout: 2000 })
    await button.hover({ timeout: 2000 })
    await expect(h.page.getByTestId('layout-picker')).toBeVisible({ timeout: 2000 })
  }).toPass({ timeout: 20000 })
  return h.page.getByTestId('layout-picker')
}

test('a running session moved out of a pane with another tab keeps its terminal output', async () => {
  // Two tabs in one pane, so moving one of them is a *real* remount (placeInZone only carries the
  // whole pane, unchanged, when the moved tab was the only one in it — see layout.ts). The pty
  // belongs to the main process regardless of which pane shows it, so the replay buffer should
  // fill the remounted view back in rather than it starting blank.
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await sidebarSession(h.page, 'Add worktree switcher').click()
  await expect(h.page.getByTestId('session-tab')).toHaveCount(2)

  const movingTab = h.page.getByTestId('session-tab').filter({ hasText: 'Add worktree switcher' })
  await movingTab.click()
  await h.page.getByTestId('shell-toggle').click()
  await h.page.getByTestId('terminal-shell').click()
  await h.page.keyboard.type('echo REMOUNT_KEEPS_$((4*4))\n')
  await expect(h.page.getByTestId('terminal-shell')).toContainText('REMOUNT_KEEPS_16', { timeout: 20000 })

  const picker = await openPickerOn(movingTab.getByTestId('session-tab-layout'), movingTab)
  await picker.getByTestId('layout-zone-halves-h-2').click()

  await expect(h.page.getByTestId('content')).toHaveAttribute('data-preset', 'halves-h')
  const moved = panes().last()
  await expect(moved).toContainText('Add worktree switcher')
  if (await moved.getByTestId('terminal-shell').count() === 0) {
    await moved.getByTestId('shell-toggle').click()
  }
  await expect(moved.getByTestId('terminal-shell')).toContainText('REMOUNT_KEEPS_16', { timeout: 15000 })
})

test('a pane\'s shell follows the session in front of it after a move', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await h.page.getByTestId('shell-toggle').click()
  await h.page.getByTestId('terminal-shell').click()
  await h.page.keyboard.type('echo SHELL_FOLLOWS_$((3*3))\n')
  await expect(h.page.getByTestId('terminal-shell')).toContainText('SHELL_FOLLOWS_9', { timeout: 20000 })

  const tab = h.page.getByTestId('session-tab').first()
  const picker = await openPickerOn(tab.getByTestId('session-tab-layout'), tab)
  await picker.getByTestId('layout-zone-halves-h-2').click()

  const moved = panes().last()
  await expect(moved).toContainText('Fix CSV export bug')
  if (await moved.getByTestId('terminal-shell').count() === 0) {
    await moved.getByTestId('shell-toggle').click()
  }
  // The same shell, not a new one: what it printed is still there.
  await expect(moved.getByTestId('terminal-shell')).toContainText('SHELL_FOLLOWS_9', { timeout: 15000 })
})
