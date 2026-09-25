import { test, expect } from '@playwright/test'
import { launchApiary, importAll, type Harness, sidebarSession, relaunchApiary } from './helpers'

/** Where a click lands on a terminal's name: its start, clear of the buttons that float over the
 *  end of the row on hover. */
const NAME_START = { position: { x: 8, y: 8 } }

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

  await h.page.getByTestId('terminal-tab-row').first().getByTestId('terminal-tab-label').click(NAME_START)
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

  await h.page.getByTestId('terminal-tab-row').first().getByTestId('terminal-tab-label').click(NAME_START)
  await expect(h.page.getByTestId('terminal-shell')).toContainText('APIARY_TAB_ONE_HISTORY', { timeout: 20000 })
})

test('renames a terminal tab', async () => {
  await h.page.getByTestId('terminal-list-toggle').click()
  await h.page.getByTestId('terminal-tab-label').dblclick(NAME_START)
  await h.page.getByTestId('terminal-tab-rename-input').fill('Build watcher')
  await h.page.getByTestId('terminal-tab-rename-input').press('Enter')
  await expect(h.page.getByTestId('terminal-tab-label')).toHaveText('Build watcher')
})

test('F2 in a terminal renames that terminal, opening the list to do it in', async () => {
  await h.page.getByTestId('terminal-add').click()
  await expect(h.page.getByTestId('terminal-tab-row')).toHaveCount(2)
  // Hidden first, so the key is shown to bring the list back rather than relying on it being open.
  await h.page.getByTestId('terminal-list-toggle').click()
  await expect(h.page.getByTestId('terminal-list-panel')).toHaveCount(0)

  await h.page.getByTestId('terminal-shell').click()
  await h.page.keyboard.press('F2')
  const input = h.page.getByTestId('terminal-tab-rename-input')
  await expect(input).toBeFocused()
  // The one in front is the second, just added — not simply the first in the list.
  await expect(input).toHaveValue('Terminal 2')
  await input.fill('Logs')
  await input.press('Enter')
  await expect(h.page.getByTestId('terminal-tab-label').last()).toHaveText('Logs')
})

test('F2 on the terminal list renames the terminal in front', async () => {
  await h.page.getByTestId('terminal-list-toggle').click()
  await h.page.getByTestId('terminal-list-panel').focus()
  await h.page.keyboard.press('F2')
  await expect(h.page.getByTestId('terminal-tab-rename-input')).toHaveValue('Terminal 1')
  await h.page.keyboard.press('Escape')
  // Escaped, and not reopened when the list is hidden and shown again.
  await h.page.getByTestId('terminal-list-toggle').click()
  await h.page.getByTestId('terminal-list-toggle').click()
  await expect(h.page.getByTestId('terminal-tab-rename-input')).toHaveCount(0)
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

test('arrowing through the terminal list moves the selection without boxing the row you clicked', async () => {
  await h.page.getByTestId('terminal-add').click()
  await h.page.getByTestId('terminal-add').click()
  const rows = h.page.getByTestId('terminal-tab-row')
  await expect(rows).toHaveCount(3)

  await rows.nth(1).getByTestId('terminal-tab-label').click(NAME_START)
  await expect(rows.nth(1)).toHaveAttribute('data-active', 'true')

  await h.page.keyboard.press('ArrowUp')
  await expect(rows.first()).toHaveAttribute('data-active', 'true')
  await expect(rows.first()).toHaveAttribute('data-keyboard-focused', 'true')
  await expect(rows.nth(1)).toHaveAttribute('data-keyboard-focused', 'false')

  // The reported bug: DOM focus stayed on the button of the row that was clicked, so pressing a
  // key made Chromium draw its own focus ring around it — a box around a row that the selection
  // had already left, and one that reads as the rename field a row turns into.
  const focused = await h.page.evaluate(() => document.activeElement?.className ?? '')
  expect(focused).toContain('terminal-list-panel')

  await h.page.keyboard.press('ArrowDown')
  await expect(rows.nth(1)).toHaveAttribute('data-active', 'true')
})

test('the terminal list fits its longest name, can be dragged wider, and remembers it', async () => {
  await h.page.getByTestId('terminal-add').click()
  // Looked up afresh each time: the relaunch below replaces the page.
  const list = () => h.page.getByTestId('terminal-list-panel')
  await expect(list()).toBeVisible()
  const width = async (): Promise<number> => Math.round((await list().boundingBox())!.width)
  // "Terminal 2" needs far less than the fixed 180px the list used to take from the terminal.
  const fitted = await width()
  expect(fitted).toBeLessThan(150)
  // ...and fits it whole: no name is cut short to hold room for the hover buttons.
  const cut = () => h.page.getByTestId('terminal-tab-label').evaluateAll(
    (labels) => labels.filter((l) => l.scrollWidth > l.clientWidth).map((l) => l.textContent),
  )
  expect(await cut()).toEqual([])

  // Hovering a row shows its buttons over the row's end: the list does not jump wider.
  await h.page.getByTestId('terminal-tab-row').first().hover()
  await expect(h.page.getByTestId('terminal-tab-delete').first()).toBeVisible()
  expect(await width()).toBe(fitted)

  // A longer name widens the fitted list.
  await h.page.getByTestId('terminal-tab-rename').first().click()
  await h.page.getByTestId('terminal-tab-rename-input').fill('Integration test watcher')
  await h.page.getByTestId('terminal-tab-rename-input').press('Enter')
  await expect.poll(width).toBeGreaterThan(fitted + 30)
  expect(await cut()).toEqual([])
  const longer = await width()

  // Dragged: its left edge is the handle, so dragging left widens it.
  const handle = (await h.page.getByTestId('terminal-list-resizer').boundingBox())!
  await h.page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await h.page.mouse.down()
  await h.page.mouse.move(handle.x + handle.width / 2 - 80, handle.y + handle.height / 2, { steps: 4 })
  await h.page.mouse.up()
  await expect.poll(width).toBeGreaterThan(longer + 60)
  await expect(list()).toHaveAttribute('data-fitted', 'false')
  const dragged = await width()

  await relaunchApiary(h)
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await h.page.getByTestId('shell-toggle').click()
  await h.page.getByTestId('terminal-list-toggle').click()
  await expect.poll(width).toBe(dragged)

  // Double-clicking the handle goes back to fitting the names.
  await h.page.getByTestId('terminal-list-resizer').dblclick()
  await expect(list()).toHaveAttribute('data-fitted', 'true')
  await expect.poll(width).toBeLessThan(dragged)
})

test('the shell prompt is just "$" by default, and the full prompt is back with the setting off', async () => {
  // The terminal in front: after "+" there are two, and the other is hidden behind it.
  const shell = () => h.page.locator('[data-testid="terminal-shell"]:visible')
  const rows = shell().locator('.xterm-rows')
  // Once the shell has answered one command, its next prompt is drawn before anything is typed.
  const ready = async (marker: string): Promise<void> => {
    await shell().click()
    await h.page.keyboard.type(`echo ${marker}\n`)
    // The command's output — a row that is just the marker — not the echo of what was typed.
    await expect.poll(() => rows.evaluate((el, m) => [...el.children].some((r) => (r.textContent ?? '').trim() === m), marker), { timeout: 20000 }).toBe(true)
    await h.page.waitForTimeout(300)
  }
  await ready('WARM_1')
  await h.page.keyboard.type('echo MINIMAL_OK\n')
  await expect(rows).toContainText('MINIMAL_OK')
  // The line the command was typed on starts with the prompt: nothing but "$ ".
  const typedOn = async (marker: string): Promise<string> => rows.evaluate((el, m) =>
    [...el.children].map((r) => (r.textContent ?? '').replace(/ /g, ' ')).find((t) => t.includes(`echo ${m}`)) ?? '', marker)
  expect(await typedOn('MINIMAL_OK')).toMatch(/^\$ echo MINIMAL_OK/)

  await h.app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].webContents.send('apiary:open-settings-dialog') })
  await h.page.getByTestId('settings-nav-terminal').click()
  await expect(h.page.getByTestId('setting-terminal-minimal-prompt')).toBeChecked()
  await h.page.getByTestId('setting-terminal-minimal-prompt').click()
  await h.page.getByTestId('settings-save').click()
  // Applies to terminals opened from now on.
  await h.page.getByTestId('terminal-add').click()
  await expect(h.page.getByTestId('terminal-tab-row')).toHaveCount(2)
  await expect(h.page.getByTestId('terminal-list-panel')).toBeVisible()
  await h.page.waitForTimeout(500)
  await ready('WARM_2')
  await h.page.keyboard.type('echo FULL_OK\n')
  await expect(rows).toContainText('FULL_OK')
  expect(await typedOn('FULL_OK')).not.toMatch(/^\$ echo FULL_OK/)
})

test('the terminal in front is a lifted chip, not a bar down its edge', async () => {
  await h.page.getByTestId('terminal-add').click()
  const rows = h.page.getByTestId('terminal-tab-row')
  await rows.nth(1).getByTestId('terminal-tab-label').click(NAME_START)
  await h.page.keyboard.press('ArrowUp')
  await expect(rows.first()).toHaveAttribute('data-active', 'true')
  await h.page.mouse.move(0, 0)
  const shadow = () => rows.first().evaluate((row) => getComputedStyle(row).boxShadow)
  // A ring and a soft drop shadow, as on the active tab (polled: it eases in) — and no inset bar.
  await expect.poll(shadow).toMatch(/0px 1px 3px/)
  const look = await rows.first().evaluate((row) => ({
    shadow: getComputedStyle(row).boxShadow,
    labelShadow: getComputedStyle(row.querySelector('.terminal-tab-label')!).boxShadow,
  }))
  expect(look.shadow).not.toContain('inset')
  expect(look.labelShadow).toBe('none')
})
