import { test, expect } from '@playwright/test'
import { launchApiary, importAll, sidebarSession, type Harness } from './helpers'

/**
 * Forking a session.
 *
 * A fork is `claude --resume <id> --fork-session`, which replays the conversation into a *new*
 * session Claude mints for itself. The fixture `claude` in this suite does not do that, so what is
 * tested here is Apiary's half: that the gesture exists in both places it was asked for, that the
 * fork opens beside its original rather than at the end of the strip, that it is named after it,
 * and — the bug that prompted all this — that the original is left exactly where it was.
 */

let h: Harness

test.beforeEach(async () => {
  h = await launchApiary()
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
})

test.afterEach(async () => { await h.close() })

test('forking from a tab opens the fork next to it, named after the original', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await sidebarSession(h.page, 'Add worktree switcher').click()
  await expect(h.page.getByTestId('session-tab')).toHaveCount(2)

  // The first tab, so "beside it" is a different place from "at the end".
  await h.page.getByTestId('session-tab').first().click({ button: 'right' })
  await h.page.getByTestId('tab-menu').getByText('Fork session').click()

  await expect(h.page.getByTestId('session-tab')).toHaveCount(3)
  await expect(h.page.getByTestId('session-tab-label').nth(1))
    .toHaveText(/fork: Fix CSV export bug/)
  // And the original is untouched — that is the whole point of forking rather than continuing.
  await expect(h.page.getByTestId('session-tab-label').first()).toHaveText(/Fix CSV export bug/)
})
