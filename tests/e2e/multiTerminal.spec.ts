import { test, expect } from '@playwright/test'
import { launchApiary, importAll, type Harness, sidebarSession } from './helpers'

let h: Harness
test.beforeEach(async () => {
  h = await launchApiary()
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await h.page.getByTestId('shell-toggle').click()
  await expect(h.page.getByTestId('terminal-shell')).toBeVisible()
})
test.afterEach(async () => { await h.close() })

test('adds a second terminal and switches between them', async () => {
  await h.page.getByTestId('terminal-add').click()
  await expect(h.page.getByTestId('terminal-tab-row')).toHaveCount(2)

  await h.page.getByTestId('terminal-shell').click()
  await h.page.keyboard.type('echo APIARY_TAB_TWO\n')
  await expect(h.page.getByTestId('terminal-shell')).toContainText('APIARY_TAB_TWO', { timeout: 20000 })

  await h.page.getByTestId('terminal-tab-row').first().getByTestId('terminal-tab-label').click()
  await h.page.getByTestId('terminal-shell').click()
  await h.page.keyboard.type('echo APIARY_TAB_ONE\n')
  await expect(h.page.getByTestId('terminal-shell')).toContainText('APIARY_TAB_ONE', { timeout: 20000 })
  await expect(h.page.getByTestId('terminal-shell')).not.toContainText('APIARY_TAB_TWO')
})

test('switching away from a terminal and back preserves its scrollback', async () => {
  await h.page.getByTestId('terminal-shell').click()
  await h.page.keyboard.type('echo APIARY_TAB_ONE_HISTORY\n')
  await expect(h.page.getByTestId('terminal-shell')).toContainText('APIARY_TAB_ONE_HISTORY', { timeout: 20000 })

  await h.page.getByTestId('terminal-add').click()
  await expect(h.page.getByTestId('terminal-tab-row')).toHaveCount(2)

  await h.page.getByTestId('terminal-tab-row').first().getByTestId('terminal-tab-label').click()
  await expect(h.page.getByTestId('terminal-shell')).toContainText('APIARY_TAB_ONE_HISTORY', { timeout: 20000 })
})

test('renames a terminal tab', async () => {
  await h.page.getByTestId('terminal-list-toggle').click()
  await h.page.getByTestId('terminal-tab-label').dblclick()
  await h.page.getByTestId('terminal-tab-rename-input').fill('Build watcher')
  await h.page.getByTestId('terminal-tab-rename-input').press('Enter')
  await expect(h.page.getByTestId('terminal-tab-label')).toHaveText('Build watcher')
})

test('a rename button and a delete button both appear on hovering a terminal row', async () => {
  // With several terminals open there was previously no discoverable way to manage them beyond
  // double-clicking the label (to rename) or a trash icon easy to miss — both actions now have a
  // dedicated, hover-revealed button.
  await h.page.getByTestId('terminal-add').click()
  await expect(h.page.getByTestId('terminal-tab-row')).toHaveCount(2)

  const row = h.page.getByTestId('terminal-tab-row').first()
  await expect(row.getByTestId('terminal-tab-rename')).toBeHidden()
  await expect(row.getByTestId('terminal-tab-delete')).toBeHidden()

  await row.hover()
  await expect(row.getByTestId('terminal-tab-rename')).toBeVisible()
  await expect(row.getByTestId('terminal-tab-delete')).toBeVisible()

  await row.getByTestId('terminal-tab-rename').click()
  await h.page.getByTestId('terminal-tab-rename-input').fill('Dev server')
  await h.page.getByTestId('terminal-tab-rename-input').press('Enter')
  await expect(row.getByTestId('terminal-tab-label')).toHaveText('Dev server')

  await row.hover()
  await row.getByTestId('terminal-tab-delete').click()
  await expect(h.page.getByTestId('terminal-tab-row')).toHaveCount(1)
})

test('deletes a terminal tab, switching to a remaining one', async () => {
  await h.page.getByTestId('terminal-add').click()
  await expect(h.page.getByTestId('terminal-tab-row')).toHaveCount(2)

  const last = h.page.getByTestId('terminal-tab-row').last()
  await last.hover()
  await last.getByTestId('terminal-tab-delete').click()
  await expect(h.page.getByTestId('terminal-tab-row')).toHaveCount(1)
  await expect(h.page.getByTestId('terminal-shell')).toBeVisible()
})

test('deleting the last terminal collapses the pane back to Show shell', async () => {
  await h.page.getByTestId('terminal-list-toggle').click()
  const row = h.page.getByTestId('terminal-tab-row')
  await row.hover()
  await row.getByTestId('terminal-tab-delete').click()
  await expect(h.page.getByTestId('shell-toggle')).toContainText('Show shell')
  await expect(h.page.getByTestId('terminal-shell')).toHaveCount(0)
})

test('the "+" button reveals the terminal list, so a new terminal is visibly a new terminal', async () => {
  // Without this the list stays shut and the new terminal is indistinguishable from the one
  // already on screen — the click reads as having done nothing at all.
  await expect(h.page.getByTestId('terminal-list-panel')).toHaveCount(0)
  await h.page.getByTestId('terminal-add').click()
  await expect(h.page.getByTestId('terminal-list-panel')).toBeVisible()
  await expect(h.page.getByTestId('terminal-tab-row')).toHaveCount(2)
})

test('hiding and reshowing the shell keeps what was running in it on screen', async () => {
  await h.page.getByTestId('terminal-shell').click()
  await h.page.keyboard.type('echo APIARY_SURVIVES_HIDE\n')
  await expect(h.page.getByTestId('terminal-shell')).toContainText('APIARY_SURVIVES_HIDE', { timeout: 20000 })

  await h.page.getByTestId('shell-toggle').click()
  await expect(h.page.getByTestId('terminal-shell')).toHaveCount(0)
  await h.page.getByTestId('shell-toggle').click()

  // Collapsing the pane must not discard the terminal: a dev server logging away in there is
  // still the same process with the same history when the pane comes back.
  await expect(h.page.getByTestId('terminal-shell')).toContainText('APIARY_SURVIVES_HIDE')
})

test('the terminal never renders taller than the space it has, at any pane size', async () => {
  // The recurring "bottom of the terminal is cut off". `.terminal-tab-view` was a plain block, so
  // `.terminal-host`'s `flex: 1` was inert and its height fell back to `auto` — i.e. to xterm's own
  // content. FitAddon measures that host to decide how many rows fit, so the measurement was
  // self-referential: it reported the size the terminal already was rather than the size available
  // to it, the row count never came down, and the overflow was clipped by the pane. Measured at the
  // time: a 352px host inside a 167px row, its last ~11 rows rendered below the window.
  const geometry = async (): Promise<{ host: number; row: number; overshoot: number }> =>
    h.page.evaluate(() => {
      const host = document.querySelector('[data-testid="terminal-shell"]') as HTMLElement
      const row = document.querySelector('.terminal-panel-row') as HTMLElement
      const h1 = host.getBoundingClientRect()
      const r1 = row.getBoundingClientRect()
      return {
        host: Math.round(h1.height),
        row: Math.round(r1.height),
        overshoot: Math.round(h1.bottom - r1.bottom),
      }
    })

  const initial = await geometry()
  expect(initial.host).toBeLessThanOrEqual(initial.row + 1)
  expect(initial.overshoot).toBeLessThanOrEqual(1)

  // And it keeps up when the space it has shrinks, rather than holding on to its old height.
  await h.page.evaluate(() => {
    const pane = document.querySelector('.bottom-pane') as HTMLElement
    pane.style.height = '120px'
  })
  await h.page.waitForTimeout(400)

  const shrunk = await geometry()
  expect(shrunk.row).toBeLessThan(initial.row)
  expect(shrunk.host).toBeLessThanOrEqual(shrunk.row + 1)
  expect(shrunk.overshoot).toBeLessThanOrEqual(1)
})

test('a long branch name ellipsizes instead of growing the toolbar into the terminal', async () => {
  const toolbarHeight = async (): Promise<number> =>
    h.page.locator('.toolbar').first().evaluate((el) => Math.round(el.getBoundingClientRect().height))
  const before = await toolbarHeight()

  // Three columns makes each one narrow — the case where the branch label used to wrap over three
  // lines, and every line it grew was a line taken from the terminal below it.
  await h.page.getByTestId('session-tab-split').click()
  await h.page.getByTestId('session-tab-split').first().click()
  await expect(h.page.getByTestId('session-column')).toHaveCount(3)
  await h.page.waitForTimeout(300)

  expect(await toolbarHeight()).toBe(before)
})
