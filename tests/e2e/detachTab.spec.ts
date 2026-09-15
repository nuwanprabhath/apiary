import { test, expect } from '@playwright/test'
import { launchApiary, importAll, sidebarSession, type Harness } from './helpers'

/**
 * Moving a session into a window of its own.
 *
 * The drag gesture itself (tearing a tab off by dropping it on the desktop) cannot be driven from
 * Playwright — it needs a real OS drag ending outside every window, and `dropEffect` is decided by
 * the platform's drag manager. What *is* driven here is everything the gesture routes through:
 * the menu item, the window it opens, what that window shows, and the fact that the tab leaves the
 * window it came from. The drag handler is the same call with a pointer position.
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
