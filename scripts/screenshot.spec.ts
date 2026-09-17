import { test, expect } from '@playwright/test'
import { join } from 'node:path'
import { launchApiary, importAll, clickRowAction, sidebarSession, type Harness } from '../tests/e2e/helpers'

/**
 * Not a test — a one-off Playwright script that launches the real app against a representative
 * fixture, arranges the UI to show off its main features, and overwrites `docs/screenshot.png`
 * for the README. Run it with `npm run screenshot` whenever a change is significant enough that
 * the README's picture of the app should catch up.
 *
 * It lives here rather than under `tests/e2e/` deliberately: Playwright's config points its
 * default test run at `tests/e2e` (see `playwright.config.ts`), so `npm run test:e2e` never
 * discovers this file, and it asserts nothing anyway — its only job is the PNG it writes.
 */
test('capture the README screenshot', async () => {
  test.setTimeout(60000)
  // The test suite runs the app off-screen so it doesn't take the machine over for minutes at a
  // time; this one is the exception, because a picture of the app is the entire output.
  process.env.APIARY_HEADED = '1'
  // The default fixture (see helpers.ts) is exactly what a README picture wants: three distinct
  // project folders, one of them a git repo with a real nested worktree, four sessions with
  // human-sounding titles — a believable slice of a real dev's history rather than contrived
  // "Test Session 1/2/3" rows. One is flagged live, so the sidebar shows its running-session dot
  // without needing an actual `claude` process (which may not even be on this machine's PATH).
  const h: Harness = await launchApiary({
    fakeLiveSessionId: '33333333-3333-3333-3333-333333333333', // "Repo root session"
  })
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()

  // A roomy window — big enough for a large pane and two stacked ones, each with a shell, without
  // either the sidebar or a pane looking cramped.
  await h.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(1760, 1050)
  })

  // Pin the session you'd actually be checking on, to show the Pinned section doing its job.
  const pinRow = h.page.locator('.session-row-wrap').filter({ hasText: 'Repo root session' })
  await clickRowAction(pinRow, 'pin-session-button')

  // Point the app at a stand-in `claude` before resuming anything, so a pane can show a session
  // actually running. The real CLI needs an API key and a network, and would render something
  // different on every run — none of which belongs in a committed picture. This goes through the
  // app's own Settings rather than a fixture file, because that is the path that also tells the
  // running service about it.
  await h.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('apiary:open-settings-dialog')
  })
  await h.page.getByTestId('settings-nav-general').click()
  await h.page.getByTestId('claude-bin-input').fill(join(process.cwd(), 'scripts', 'fixtures', 'fake-claude.sh'))
  await h.page.getByTestId('settings-save').click()
  await h.page.getByTestId('settings-dialog').waitFor({ state: 'detached' })

  // Three sessions in a layout — search on the left, several conversations open at once, the large
  // one with its shell running underneath it. Three splits give "main and two on the right".
  await sidebarSession(h.page, 'Repo root session').click()
  for (const title of ['Add worktree switcher', 'Worktree session']) {
    const target = h.page.locator('.session-row-wrap').filter({ hasText: title })
    await clickRowAction(target, 'split-session-button')
  }
  await expect(h.page.getByTestId('content')).toHaveAttribute('data-preset', 'main-right2')

  // The session about to be resumed goes into the large pane, through the layout picker on its own
  // tab — the feature the picture is showing off. Not the fixture's "already running elsewhere"
  // session, because resuming that one deliberately asks before doing anything.
  const tab = h.page.getByTestId('session-tab').filter({ hasText: 'Add worktree switcher' })
  await expect(async () => {
    await tab.hover({ timeout: 2000 })
    await tab.getByTestId('session-tab-layout').hover({ timeout: 2000 })
    await expect(h.page.getByTestId('layout-picker')).toBeVisible({ timeout: 2000 })
  }).toPass({ timeout: 20000 })
  await h.page.getByTestId('layout-zone-main-right2-1').click()
  await expect(h.page.getByTestId('layout-picker')).toHaveCount(0)

  const columns = h.page.getByTestId('session-column')

  // Resume it, so the picture shows what the app is actually for: a live Claude Code session
  // running inside it. The others stay on their transcripts, which is the other half of what it
  // does — reading history and working in it, side by side.
  const live = columns.first()
  await live.getByTestId('resume-button').click()
  await expect(live.getByTestId('terminal-session')).toContainText('Claude Code', { timeout: 20000 })

  // A shell under the large pane only: the two stacked panes are half height, and a shell in each
  // leaves their transcripts no room to be read — which is the half of the picture they are for.
  const shellPanes = 1
  for (let i = 0; i < shellPanes; i++) {
    await columns.nth(i).getByTestId('shell-toggle').click()
  }
  for (let i = 0; i < shellPanes; i++) {
    const shell = columns.nth(i).getByTestId('terminal-shell')
    await shell.click()
    // This is a real, live shell in whatever directory the session ran in — genuinely running,
    // which is the point — but its default prompt bakes in this machine's hostname and username.
    // Since this screenshot is committed to a public README, replace it with a plain, generic
    // one instead of publishing whoever happened to run this script's login name.
    await h.page.keyboard.type('export PS1="$ "; clear\n')
  }
  // Give each shell a moment to apply the new prompt and settle, and move the pointer off the
  // panes so no hover card or picker is caught in the picture.
  await h.page.mouse.move(2, 2)
  await h.page.waitForTimeout(1000)

  // The Refresh above reports what it found, which is useful in the app and noise in a README
  // image. Close whatever is still on screen rather than waiting out its dwell time.
  for (const close of await h.page.getByTestId('notification-close').all()) await close.click()
  await expect(h.page.getByTestId('notification')).toHaveCount(0)

  await h.page.screenshot({ path: join(process.cwd(), 'docs', 'screenshot.png') })
  await h.close()
})
