import { test, expect } from '@playwright/test'
import { writeFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { launchApiary, importAll, sidebarSession, type Harness } from './helpers'

/** Same stand-in newSession.spec.ts uses: a script that just execs the login shell, so a new
 *  session's terminal is something a test can actually converse with and kill. */
async function useFakeClaudeShell(h: Harness): Promise<void> {
  const script = join(h.home, 'fake-claude.sh')
  writeFileSync(script, '#!/bin/sh\nexec "$SHELL" -l\n')
  chmodSync(script, 0o755)
  await h.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('apiary:open-settings-dialog')
  })
  await h.page.getByTestId('settings-nav-general').click()
  await h.page.getByTestId('claude-bin-input').fill(script)
  await h.page.getByTestId('settings-save').click()
  await expect(h.page.getByTestId('settings-dialog')).toHaveCount(0)
}

let h: Harness

test.beforeEach(async () => {
  h = await launchApiary()
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
})

test.afterEach(async () => { await h.close() })

test('Active lists open sessions from both windows and clicking a row focuses the right window', { tag: '@serial' }, async () => {
  await h.page.getByTestId('session-item').first().click()

  const second = await h.newWindow()
  await second.getByTestId('sidebar-refresh').click()
  await second.getByTestId('session-item').nth(1).click()

  const active = h.page.getByTestId('active-section')
  await expect(active).toBeVisible()
  await expect(active.getByTestId('active-tab-row')).toHaveCount(2)

  const otherRowText = await second.getByTestId('session-item').nth(1).innerText()
  const otherRow = active.getByTestId('active-tab-row').filter({ hasText: otherRowText })

  // Confirm focusTab only focuses and selects — it never migrates the tab between windows,
  // unlike tabDropped. The first window's own tab bar must stay exactly as it was.
  const firstWindowTabBarBefore = await h.page.getByTestId('session-tab-bar').innerText()

  await otherRow.click()
  await expect.poll(() => second.evaluate(() => document.hasFocus())).toBe(true)

  const firstWindowTabBarAfter = h.page.getByTestId('session-tab-bar')
  await expect(firstWindowTabBarAfter).toHaveText(firstWindowTabBarBefore)
})

test('an Active row for a tab open in another window keeps its title even when this window\'s own search excludes it', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()

  const second = await h.newWindow()
  await second.getByTestId('sidebar-refresh').click()
  await sidebarSession(second, 'Add worktree switcher').click()

  // A search here that matches the second window's own tab, but not "Fix CSV export bug" —
  // narrowing this window's tree must not turn the *other* window's Active row into a raw id.
  await h.page.getByTestId('search-input').fill('worktree switcher')
  // The tree's rows only: the Active section is in the sidebar too, and its row for this very
  // tab appears once the tab report lands — the check passed only when it ran before that did.
  await expect(h.page.getByTestId('session-item').filter({ hasText: 'Fix CSV export bug' })).toHaveCount(0)

  const active = h.page.getByTestId('active-section')
  const ownRow = active.getByTestId('active-tab-row').filter({ hasText: 'Fix CSV export bug' })
  await expect(ownRow).toBeVisible()
})

test('status dot reflects a stopped pty', async () => {
  await useFakeClaudeShell(h)
  await h.page.getByTestId('session-item').first().click()
  await expect(h.page.getByTestId('composer')).toBeVisible()
  await h.page.getByTestId('composer-input').fill('echo hi')
  await h.page.getByTestId('composer-send').click()
  await expect(h.page.getByTestId('terminal-session')).toBeVisible({ timeout: 20000 })

  // Killing the shell from within it lets the pty exit on its own, the same signal `classifyActivity`
  // reads for 'stopped' — not a simulated status, the real exit path.
  // eslint-disable-next-line playwright/no-force-option -- xterm mounts its own internal DOM layers inside this host div, so Playwright's actionability hit-test can land on a different xterm-internal element than expected; force is needed to focus the terminal for the keyboard input that follows
  await h.page.getByTestId('terminal-session').click({ force: true })
  await h.page.keyboard.type('exit\n')

  const dot = h.page.getByTestId('active-section').getByTestId('active-status-dot')
  await expect(dot).toHaveAttribute('data-status', 'stopped', { timeout: 20000 })
})

test('a session torn off into its own window still appears in Active', async () => {
  // Mission control is only mission control if it sees every window. A detached window is
  // excluded from the *layout* record on purpose (a torn-off tab is not part of the restorable
  // arrangement) — but that exclusion once took its tab report with it, so the one window most
  // likely to be on another screen, behind everything else, was the one window whose session
  // never showed up here.
  await sidebarSession(h.page, 'Fix CSV export bug').click()

  const opened = h.app.waitForEvent('window')
  await h.page.getByTestId('session-tab').first().click({ button: 'right' })
  await h.page.getByTestId('tab-menu').getByText('Move into New Window').click()
  await (await opened).waitForLoadState('domcontentloaded')

  // The tab has left this window entirely, so anything in Active can only be the torn-off one.
  await expect(h.page.getByTestId('session-tab')).toHaveCount(0)

  const active = h.page.getByTestId('active-section')
  await expect(active.getByTestId('active-tab-row')).toHaveCount(1)
  await expect(active.getByTestId('active-tab-row')).toHaveText(/Fix CSV export bug/)
})

