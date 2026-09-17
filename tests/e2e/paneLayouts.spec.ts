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

const content = (): Locator => h.page.getByTestId('content')
const panes = (): Locator => h.page.getByTestId('session-column')
const row = (title: string): Locator => h.page.locator('.session-row-wrap').filter({ hasText: title })

async function openPickerOn(button: Locator, hoverFirst?: Locator): Promise<Locator> {
  await expect(async () => {
    if (hoverFirst !== undefined) await hoverFirst.hover({ timeout: 2000 })
    await button.hover({ timeout: 2000 })
    await expect(h.page.getByTestId('layout-picker')).toBeVisible({ timeout: 2000 })
  }).toPass({ timeout: 20000 })
  return h.page.getByTestId('layout-picker')
}

test('resting on a sidebar row\'s split button offers the layouts, and a zone places the session there', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  const target = row('Add worktree switcher')
  const picker = await openPickerOn(target.getByTestId('split-session-button'), target)

  await picker.getByTestId('layout-zone-halves-h-1').click()

  await expect(content()).toHaveAttribute('data-preset', 'halves-h')
  await expect(panes()).toHaveCount(2)
  await expect(panes().first()).toContainText('Add worktree switcher')
  await expect(panes().last()).toContainText('Fix CSV export bug')
  await expect(h.page.getByTestId('layout-picker')).toHaveCount(0)
})

test('a plain click on the split button still opens to the side', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  const target = row('Add worktree switcher')
  await target.hover()
  await target.getByTestId('split-session-button').click()
  await expect(panes()).toHaveCount(2)
  await expect(h.page.getByTestId('layout-picker')).toHaveCount(0)
})

test('a sidebar row\'s split button focuses the pane it just opened, not pane one', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  const target = row('Add worktree switcher')
  await target.hover()
  await target.getByTestId('split-session-button').click()
  await expect(panes()).toHaveCount(2)
  await expect(panes().last()).toContainText('Add worktree switcher')
  await expect(panes().last()).toHaveAttribute('data-active', 'true')
})

test('the tab strip\'s split button focuses the pane it just opened', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await h.page.getByTestId('session-tab-split').click()
  await expect(panes()).toHaveCount(2)
  await expect(panes().last()).toHaveAttribute('data-active', 'true')
})

test('placing a sidebar session via the picker focuses the new pane even in a non-first zone', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  const target = row('Add worktree switcher')
  const picker = await openPickerOn(target.getByTestId('split-session-button'), target)
  // thirds-h zone 3 (0-indexed 2, testid suffix z+1) is the last zone: "Fix CSV export bug" fills
  // zone 1, zone 2 is left waiting, and the placed session lands last — not first, so a stale
  // fallback to "pane one" cannot pass this test by accident.
  await picker.getByTestId('layout-zone-thirds-h-3').click()
  await expect(content()).toHaveAttribute('data-preset', 'thirds-h')
  await expect(panes().first()).toContainText('Fix CSV export bug')
  await expect(panes().first()).not.toHaveAttribute('data-active', 'true')
  const placed = panes().last()
  await expect(placed).toContainText('Add worktree switcher')
  await expect(placed).toHaveAttribute('data-active', 'true')
})

test('a tab moved to another zone is moved, not copied', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await sidebarSession(h.page, 'Add worktree switcher').click()
  await expect(h.page.getByTestId('session-tab')).toHaveCount(2)

  const tab = h.page.getByTestId('session-tab').filter({ hasText: 'Add worktree switcher' })
  const picker = await openPickerOn(tab.getByTestId('session-tab-layout'), tab)
  await picker.getByTestId('layout-zone-halves-v-2').click()

  await expect(content()).toHaveAttribute('data-preset', 'halves-v')
  await expect(panes().first().getByTestId('session-tab')).toHaveCount(1)
  await expect(panes().first()).toContainText('Fix CSV export bug')
  await expect(panes().last().getByTestId('session-tab')).toHaveText(['Add worktree switcher'])
})

test('Arrange… from a tab\'s menu opens the picker where the menu was', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await h.page.getByTestId('session-tab').first().click({ button: 'right' })
  await h.page.getByTestId('tab-menu').getByText('Arrange…').click()
  const picker = h.page.getByTestId('layout-picker')
  await expect(picker).toBeVisible()
  await picker.getByTestId('layout-zone-grid-4').click()
  await expect(content()).toHaveAttribute('data-preset', 'grid')
  await expect(panes()).toHaveCount(4)
  await expect(panes().nth(3)).toContainText('Fix CSV export bug')
})

test('Arrange… from a sidebar session\'s menu opens that session in the chosen zone', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await row('Repo root session').click({ button: 'right' })
  await h.page.getByText('Arrange…').click()
  await h.page.getByTestId('layout-zone-main-right2-1').click()
  await expect(content()).toHaveAttribute('data-preset', 'main-right2')
  await expect(panes().first()).toContainText('Repo root session')
})

test('the window layout button changes the layout without moving any session', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await h.page.getByTestId('window-layout-button').click()
  await h.page.getByTestId('layout-picker').getByTestId('layout-option-halves-v').click()
  await expect(content()).toHaveAttribute('data-preset', 'halves-v')
  await expect(panes().first()).toContainText('Fix CSV export bug')
  await expect(panes().last()).toHaveAttribute('data-placeholder', 'true')
})

test('there is one window layout button, on the pane at the top-right corner', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await h.page.getByTestId('window-layout-button').click()
  await h.page.getByTestId('layout-option-grid').click()
  await expect(h.page.getByTestId('window-layout-button')).toHaveCount(1)
  await expect(panes().nth(1).getByTestId('window-layout-button')).toHaveCount(1)
})

test('arrow keys move focus in the picker and Enter chooses the focused thumbnail', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await h.page.getByTestId('window-layout-button').click()
  await h.page.keyboard.press('ArrowRight')
  await h.page.keyboard.press('Enter')
  await expect(content()).toHaveAttribute('data-preset', 'halves-h')
})

test('the picker marks the current layout and closes on Escape', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await h.page.getByTestId('window-layout-button').click()
  const picker = h.page.getByTestId('layout-picker')
  await expect(picker.getByTestId('layout-option-single')).toHaveAttribute('data-current', 'true')
  await h.page.keyboard.press('Escape')
  await expect(picker).toHaveCount(0)
})

test('a divider in the grid resizes the panes either side of it', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await h.page.getByTestId('window-layout-button').click()
  await h.page.getByTestId('layout-option-grid').click()
  const handle = (await h.page.getByTestId('row-resizer').boundingBox())!
  const before = (await panes().first().boundingBox())!
  await h.page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await h.page.mouse.down()
  await h.page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 + 80, { steps: 5 })
  await h.page.mouse.up()
  const after = (await panes().first().boundingBox())!
  expect(after.height).toBeGreaterThan(before.height + 40)
})

test('closing the last tab in a pane steps the layout down', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  const target = row('Add worktree switcher')
  const picker = await openPickerOn(target.getByTestId('split-session-button'), target)
  await picker.getByTestId('layout-zone-halves-h-2').click()
  await expect(content()).toHaveAttribute('data-preset', 'halves-h')

  await panes().last().getByTestId('session-tab-close').click()
  await expect(content()).toHaveAttribute('data-preset', 'single')
  await expect(panes()).toHaveCount(1)
})

test('a pane waiting to be filled offers the open tabs and recent sessions', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await sidebarSession(h.page, 'Add worktree switcher').click()
  await h.page.getByTestId('window-layout-button').click()
  await h.page.getByTestId('layout-option-halves-h').click()

  const filler = panes().last().getByTestId('pane-filler')
  await expect(filler).toBeVisible()
  // The tab in front of the other pane is offered to move over.
  await filler.getByTestId('pane-filler-tab').filter({ hasText: 'Add worktree switcher' }).click()
  await expect(panes().last()).toContainText('Add worktree switcher')
  await expect(panes().first().getByTestId('session-tab')).toHaveCount(1)
})

test('a waiting pane opens a recent session, and its search narrows the list', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await h.page.getByTestId('window-layout-button').click()
  await h.page.getByTestId('layout-option-halves-h').click()

  const filler = panes().last().getByTestId('pane-filler')
  // Already open, so not offered as a session to open.
  await expect(filler.getByTestId('pane-filler-session').filter({ hasText: 'Fix CSV export bug' })).toHaveCount(0)
  await filler.getByTestId('pane-filler-search').fill('repo root')
  await expect(filler.getByTestId('pane-filler-session')).toHaveCount(1)
  await filler.getByTestId('pane-filler-session').click()
  await expect(panes().last()).toContainText('Repo root session')
  await expect(panes().last()).toHaveAttribute('data-placeholder', 'false')
})

test('a filler does not offer a tab that is the only one in its pane, since moving it would empty the pane', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await h.page.getByTestId('window-layout-button').click()
  await h.page.getByTestId('layout-option-halves-h').click()

  const filler = panes().last().getByTestId('pane-filler')
  // Pane 1 has exactly one tab; moving it would empty pane 1, stepping the layout back down —
  // clicking it would appear to do nothing.
  await expect(filler.getByTestId('pane-filler-tab').filter({ hasText: 'Fix CSV export bug' })).toHaveCount(0)

  // Give pane 1 a second tab: now moving either one leaves it non-empty, so both are safe to offer.
  await sidebarSession(h.page, 'Add worktree switcher').click()
  await expect(filler.getByTestId('pane-filler-tab').filter({ hasText: 'Fix CSV export bug' })).toHaveCount(1)
  await expect(filler.getByTestId('pane-filler-tab').filter({ hasText: 'Add worktree switcher' })).toHaveCount(1)
})

test('a waiting pane can be closed, stepping the layout down', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await h.page.getByTestId('window-layout-button').click()
  await h.page.getByTestId('layout-option-grid').click()
  await panes().nth(3).getByTestId('pane-filler-close').click()
  await expect(content()).toHaveAttribute('data-preset', 'main-right2')
  await expect(panes()).toHaveCount(3)
})

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

  await expect(content()).toHaveAttribute('data-preset', 'halves-h')
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
