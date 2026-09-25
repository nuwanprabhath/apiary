import { test, expect } from '@playwright/test'
import { launchApiary, importAll, sidebarSession, type Harness } from './helpers'

let h: Harness

test.beforeEach(async () => {
  h = await launchApiary()
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
})

test.afterEach(async () => { await h.close() })

test('the bottom pane shrinks to fit a short window instead of overflowing off the bottom', async () => {
  // Regression: .bottom-pane used to be a rigid (`flex: none`) fixed-height box. On a window too
  // short to fit the tab bar, header and the shell pane's full requested height, the pane simply
  // ran past the bottom of the column, and `.session-column`'s `overflow: hidden` clipped
  // whatever fell off the edge — the last line or two of a terminal, or the tail of a dropdown.
  // Kept end-to-end: it resizes the real Electron `BrowserWindow`, which a component test's fixed
  // browser viewport cannot do.
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await h.page.getByTestId('shell-toggle').click()
  await expect(h.page.getByTestId('terminal-shell')).toBeVisible()

  await h.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(1000, 420)
  })
  // Polled rather than measured once after a pause: the window has taken its new size, and the
  // pane's bottom edge lands at (or above) the window's own bottom edge — never past it.
  await expect.poll(() => h.page.evaluate(() => {
    const pane = document.querySelector('.bottom-pane')?.getBoundingClientRect()
    return window.innerHeight < 420 && pane !== undefined && pane.bottom <= window.innerHeight + 1
  })).toBe(true)
  // The toolbar (and its Hide/Show shell button) must still be reachable even when squeezed.
  await expect(h.page.getByTestId('shell-toggle')).toBeVisible()
})

test('a pane dragged by the empty part of its tab bar onto another trades places with it, whole', { tag: '@smoke' }, async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await h.page.getByTestId('session-tab-split').click()
  await sidebarSession(h.page, 'Add worktree switcher').click()
  const columns = h.page.getByTestId('session-column')
  await expect(columns).toHaveCount(2)

  // Something running in the left pane's shell, to show the pane travels rather than being rebuilt.
  await columns.first().getByTestId('shell-toggle').click()
  const leftShell = columns.first().getByTestId('terminal-shell')
  await expect(leftShell).toBeVisible()
  await leftShell.click()
  await h.page.keyboard.type('echo pane-marker-$((6*7))\n')
  await expect(leftShell).toContainText('pane-marker-42')

  const ids = () => columns.evaluateAll((els) => els.map((e) => e.getAttribute('data-column-id')))
  const tabs = (i: number) => columns.nth(i).getByTestId('session-tab-label').allTextContents()
  const [leftId, rightId] = await ids()
  const leftTabs = await tabs(0)
  const rightTabs = await tabs(1)

  // No target until a pane is being dragged.
  await expect(h.page.getByTestId('pane-drop')).toHaveCount(0)
  const strip = (await columns.first().getByTestId('session-tab-strip').boundingBox())!
  const target = (await columns.last().boundingBox())!
  await h.page.mouse.move(strip.x + strip.width - 6, strip.y + strip.height / 2)
  await h.page.mouse.down()
  await h.page.mouse.move(strip.x + strip.width + 20, strip.y + strip.height / 2, { steps: 3 })
  await expect(columns.last().getByTestId('pane-drop')).toBeVisible()
  // Only the other pane offers itself.
  await expect(h.page.getByTestId('pane-drop')).toHaveCount(1)
  await h.page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 6 })
  await expect(columns.last().getByTestId('pane-drop')).toHaveAttribute('data-over', 'true')
  await h.page.mouse.up()

  await expect.poll(ids).toEqual([rightId, leftId])
  expect(await tabs(0)).toEqual(rightTabs)
  expect(await tabs(1)).toEqual(leftTabs)
  await expect(h.page.getByTestId('pane-drop')).toHaveCount(0)
  await expect(columns.last().getByTestId('terminal-shell')).toContainText('pane-marker-42')
})
