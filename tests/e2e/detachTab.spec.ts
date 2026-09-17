import { test, expect } from '@playwright/test'
import { launchApiary, importAll, sidebarSession, type Harness } from './helpers'

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

test('a session moved into a new window arrives there, with no sidebar', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await expect(h.page.getByTestId('session-tab')).toHaveCount(1)

  const opened = h.app.waitForEvent('window')
  await h.page.getByTestId('session-tab').first().click({ button: 'right' })
  await h.page.getByTestId('tab-menu').getByText('Move into New Window').click()

  const detached = await opened
  await detached.waitForLoadState('domcontentloaded')

  // The session is what the window is for, and the library is not: a torn-off window exists to
  // give one conversation the whole screen.
  await expect(detached.getByTestId('session-title')).toHaveText('Fix CSV export bug')
  await expect(detached.getByTestId('sidebar')).toHaveCount(0)
  await expect(detached.getByTestId('sidebar-resizer')).toHaveCount(0)
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
