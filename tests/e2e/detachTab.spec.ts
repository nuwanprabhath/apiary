import { test, expect, type Page } from '@playwright/test'
import { launchApiary, importAll, sidebarSession, expectStays, type Harness } from './helpers'

/**
 * Moving a session into a window of its own.
 *
 * The drag gesture itself cannot be driven from Playwright: it needs a real OS drag, and where it
 * ends is decided by the platform's drag manager. Everything the gesture routes through is driven
 * here — the menu item, the window that opens, what it shows, the receiving window's side of a
 * move, and the fact that the tab leaves the window it came from. Which window a release landed on
 * is `pickWindowAt`, unit-tested separately.
 *
 * That split matters, because the first version of this feature shipped with the untested half
 * broken: it assumed a drag started in one window would deliver `dragover`/`drop` to another, and
 * an HTML5 drag started in one `BrowserWindow` delivers nothing to any other. Dropping a tab on a
 * second window did nothing at all.
 */

let h: Harness

test.beforeEach(async () => {
  h = await launchApiary()
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
})

test.afterEach(async () => { await h.close() })

test('a session moved into a new window arrives there, with the sidebar folded to its rail', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await expect(h.page.getByTestId('session-tab')).toHaveCount(1)

  const opened = h.app.waitForEvent('window')
  await h.page.getByTestId('session-tab').first().click({ button: 'right' })
  await h.page.getByTestId('tab-menu').getByText('Move into New Window').click()

  const detached = await opened
  await detached.waitForLoadState('domcontentloaded')

  // The session gets the room — the sidebar starts folded — but the library is a click away.
  // Reported: a torn-off window had no sidebar at all, and no way to get one.
  await expect(detached.getByTestId('session-title')).toHaveText('Fix CSV export bug')
  await expect(detached.getByTestId('sidebar-rail')).toBeVisible()
  await expect(detached.getByTestId('sidebar')).toBeHidden()

  await detached.getByTestId('sidebar-show').click()
  await expect(detached.getByTestId('sidebar')).toBeVisible()
  await expect(detached.getByTestId('sidebar-resizer')).toBeVisible()
  // A working sidebar, with the library in it.
  await expect(detached.getByTestId('session-item').filter({ hasText: 'Add worktree switcher' }).first()).toBeVisible()
})

test('a torn-off window starts folded even when an earlier window with its number had the sidebar open', async () => {
  // Window numbers are reused, and each window's sidebar state is kept under its number. Reported:
  // a tab popped out into "W6" opened with the sidebar fully out, because an earlier window 6 had
  // saved it open — and that saved record overrode the torn-off default.
  await h.page.evaluate(() => {
    for (let w = 2; w <= 9; w += 1) localStorage.setItem(`apiary.ui.${String(w)}`, JSON.stringify({ sidebarHidden: false }))
  })
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  const opened = h.app.waitForEvent('window')
  await h.page.getByTestId('session-tab').first().click({ button: 'right' })
  await h.page.getByTestId('tab-menu').getByText('Move into New Window').click()
  const detached = await opened
  await detached.waitForLoadState('domcontentloaded')

  await expect(detached.getByTestId('session-title')).toHaveText('Fix CSV export bug')
  await expect(detached.getByTestId('sidebar-rail')).toBeVisible()
  await expect(detached.getByTestId('sidebar')).toBeHidden()
})

test('a session moved into a new window never drops out of Active on the way', async () => {
  // Reported: the moved session vanished from Active and came back a moment later. The window it
  // left reported the loss at once; the new one only after loading and its report debounce.
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  const active = h.page.getByTestId('active-section').getByTestId('active-tab-row')
  await expect(active.filter({ hasText: 'Fix CSV export bug' })).toHaveCount(1)

  const opened = h.app.waitForEvent('window')
  await h.page.getByTestId('session-tab').first().click({ button: 'right' })
  await h.page.getByTestId('tab-menu').getByText('Move into New Window').click()

  // Sampled through the whole hand-over, not just at the end — from the registry Active is drawn
  // from, in the main process, rather than from the rendered rows: the bug was the registry
  // losing the tab, and sampling the DOM also measured how quickly this window repainted, which
  // under load could look like a dropped row when none was dropped.
  await expectStays(async () => {
    const tabs = await h.page.evaluate(() => window.apiary.activeTabs())
    return tabs.filter((t) => t.key === '11111111-1111-1111-1111-111111111111').length === 1
  }, 2500, 'the moved session stayed listed exactly once')
  const detached = await opened
  await expect(active.filter({ hasText: 'Fix CSV export bug' })).toContainText(/W\d/)
  await expect(detached.getByTestId('session-title')).toHaveText('Fix CSV export bug')
})

test('folding the sidebar in a torn-off window does not fold it in the main window', async () => {
  // Sidebar visibility is per window. The torn-off one starting folded must not reach back and
  // fold the sidebar of the window it came from.
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  const opened = h.app.waitForEvent('window')
  await h.page.getByTestId('session-tab').first().click({ button: 'right' })
  await h.page.getByTestId('tab-menu').getByText('Move into New Window').click()
  const detached = await opened
  await detached.waitForLoadState('domcontentloaded')
  await expect(detached.getByTestId('sidebar-rail')).toBeVisible()

  await expect(h.page.getByTestId('sidebar')).toBeVisible()
  await expect(h.page.getByTestId('sidebar-rail')).toHaveCount(0)
})

test('the window it came from lets go of it, so it is a move and not a copy', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()

  const opened = h.app.waitForEvent('window')
  await h.page.getByTestId('session-tab').first().click({ button: 'right' })
  await h.page.getByTestId('tab-menu').getByText('Move into New Window').click()
  await (await opened).waitForLoadState('domcontentloaded')

  await expect(h.page.getByTestId('session-tab')).toHaveCount(0)
})

test('opening the same session in two windows on purpose still opens it in both', async () => {
  // The claim that makes a move a move must not leak into the ordinary case: a session reached
  // from the sidebar in a second window is a second view of it, deliberately.
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  const second = await h.newWindow()
  await sidebarSession(second, 'Fix CSV export bug').click()

  await expect(second.getByTestId('session-tab')).toHaveCount(1)
  await expect(h.page.getByTestId('session-tab')).toHaveCount(1)
})

test('a tab dropped on another window arrives there showing its session', async () => {
  // The receiving half of a cross-window move. The drop itself is worked out in the main process
  // from where the pointer was released, so what lands here is a bare key — and the window has to
  // turn that into an open, readable session rather than a tab with nothing behind it, which is
  // exactly what it failed to do the first time.
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  const key = await sidebarSession(h.page, 'Fix CSV export bug')
    .locator('xpath=ancestor-or-self::*[@data-session-id]')
    .first()
    .getAttribute('data-session-id')
  expect(key).not.toBeNull()

  const second = await h.newWindow()
  await expect(second.getByTestId('session-tab')).toHaveCount(0)

  // What the main process sends the window it decided the tab was dropped on. Addressed by the
  // window number in its URL rather than by position: `getAllWindows()` answers newest-first, and
  // a test that assumes otherwise silently sends the message straight back where it came from.
  await h.app.evaluate(({ BrowserWindow }, tabKey) => {
    for (const win of BrowserWindow.getAllWindows()) {
      const isSecond = win.webContents.getURL().includes('w=2')
      if (isSecond) {
        win.webContents.send('apiary:tab-adopt', {
          key: tabKey, view: 'transcript', ptyId: null, shells: [], activeShell: null,
        })
      } else {
        win.webContents.send('apiary:tab-claimed', tabKey)
      }
    }
  }, key)

  await expect(second.getByTestId('session-tab')).toHaveCount(1)
  await expect(second.getByTestId('session-title')).toHaveText('Fix CSV export bug')
  // And it is gone from the window it came from: a move, not a copy.
  await expect(h.page.getByTestId('session-tab')).toHaveCount(0)
})

/** Moves 'Fix CSV export bug' into a window of its own and returns that window. */
async function tearOff(): Promise<Page> {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  const opened = h.app.waitForEvent('window')
  await h.page.getByTestId('session-tab').first().click({ button: 'right' })
  await h.page.getByTestId('tab-menu').getByText('Move into New Window').click()
  const detached = await opened
  await detached.waitForLoadState('domcontentloaded')
  await expect(detached.getByTestId('session-title')).toHaveText('Fix CSV export bug')
  await expect(h.page.getByTestId('session-tab')).toHaveCount(0)
  return detached
}

test('a torn-off tab dragged back onto the main window moves back there', async () => {
  // Reported: dragging it back to the main window did nothing. The release point is over the main
  // window; the torn-off window's dragend is the event a real drag ends with.
  const detached = await tearOff()
  await h.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.prototype.isVisible = function isVisible() { return true }
  })
  const bounds = await h.app.evaluate(({ BrowserWindow }) => {
    const all = BrowserWindow.getAllWindows()
    return {
      main: all.find((w) => !w.webContents.getURL().includes('detach='))?.getBounds() ?? null,
      torn: all.find((w) => w.webContents.getURL().includes('detach='))?.getBounds() ?? null,
    }
  })
  if (bounds.main === null || bounds.torn === null) throw new Error('missing a window')
  const { main, torn } = bounds
  // Over the main window and *not* under the torn-off one, which opens on top of it — as in the
  // report, where the main window's tab strip showed above the torn-off window. A point both
  // windows cover is the torn-off window's, and releasing there is rightly nothing.
  const candidates = [
    { x: main.x + 20, y: main.y + 20 },
    { x: main.x + main.width - 20, y: main.y + 20 },
    { x: main.x + 20, y: main.y + main.height - 20 },
    { x: main.x + main.width - 20, y: main.y + main.height - 20 },
  ]
  const inside = (r: { x: number; y: number; width: number; height: number }, p: { x: number; y: number }): boolean =>
    p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height
  const at = candidates.find((p) => !inside(torn, p))
  if (at === undefined) throw new Error('the torn-off window covers the main window entirely')
  await detached.getByTestId('session-tab').first().evaluate((el, point) => {
    const ev = new DragEvent('dragend', { bubbles: true, screenX: point.x, screenY: point.y, dataTransfer: new DataTransfer() })
    ev.dataTransfer!.dropEffect = 'none'
    el.dispatchEvent(ev)
  }, at)

  await expect(h.page.getByTestId('session-tab')).toHaveCount(1)
  await expect(h.page.getByTestId('session-title')).toHaveText('Fix CSV export bug')
  await expect(detached.getByTestId('session-tab')).toHaveCount(0)
})

test('a tab from another window dropped on this window\'s tab strip is taken, not ignored', async () => {
  // Where the platform delivers the drop to the window under the pointer (X11 can), the drop lands
  // on the main window's strip instead of ending as a dragend over nothing. The strip used to treat
  // it as a reorder of a tab it did not have, and nothing happened.
  const detached = await tearOff()
  const payload = await detached.getByTestId('session-tab').first().evaluate((el) => {
    // What the torn-off window's own dragstart puts on the drag.
    const dt = new DataTransfer()
    el.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
    return { key: dt.getData('application/x-apiary-tab'), transfer: dt.getData('application/x-apiary-tab-transfer') }
  })
  expect(payload.transfer).not.toBe('')

  await h.page.getByTestId('session-tab-bar').first().locator('.session-tab-strip').evaluate((el, p) => {
    const dt = new DataTransfer()
    dt.setData('application/x-apiary-tab', p.key)
    dt.setData('application/x-apiary-tab-transfer', p.transfer)
    el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
  }, payload)

  await expect(h.page.getByTestId('session-tab')).toHaveCount(1)
  await expect(h.page.getByTestId('session-title')).toHaveText('Fix CSV export bug')
  await expect(detached.getByTestId('session-tab')).toHaveCount(0)
})
