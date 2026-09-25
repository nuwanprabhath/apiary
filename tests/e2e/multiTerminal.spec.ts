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
    // The marker appearing does not mean the next prompt is drawn yet: wait for a non-blank row
    // below it, so the caller does not type on top of a prompt still being painted.
    await expect.poll(() => rows.evaluate((el, m) => {
      const lines = [...el.children].map((r) => (r.textContent ?? '').trim())
      const at = lines.lastIndexOf(m)
      return at !== -1 && lines.slice(at + 1).some((t) => t !== '')
    }, marker), { timeout: 20000 }).toBe(true)
  }
  await ready('WARM_1')
  await h.page.keyboard.type('echo MINIMAL_OK\n')
  await expect(rows).toContainText('MINIMAL_OK')
  // The line the command was typed on starts with the prompt: nothing but "$ ".
  const typedOn = async (marker: string): Promise<string> => rows.evaluate((el, m) =>
    // xterm renders spaces as U+00A0 (non-breaking space) in textContent; written as an escape
    // rather than the literal character so the source stays free of irregular whitespace.
    [...el.children].map((r) => (r.textContent ?? '').replace(/\u00A0/g, ' ')).find((t) => t.includes(`echo ${m}`)) ?? '', marker)
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
  // The freshly spawned shell has drawn its first prompt before `ready` types into it.
  await expect.poll(() => rows.evaluate((el) => [...el.children].some((r) => (r.textContent ?? '').trim() !== '')), { timeout: 20000 }).toBe(true)
  await ready('WARM_2')
  await h.page.keyboard.type('echo FULL_OK\n')
  await expect(rows).toContainText('FULL_OK')
  expect(await typedOn('FULL_OK')).not.toMatch(/^\$ echo FULL_OK/)
})
