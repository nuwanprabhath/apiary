import { test, expect } from '@playwright/test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApiary, importAll, sidebarSession, expectStays, type Harness } from './helpers'

/**
 * The diagnostic log, as the user meets it.
 *
 * The claim worth testing end to end is the one that is a promise rather than a feature: **off by
 * default, and off means nothing is written**. The rest — redaction, rotation, retention — is
 * decided by pure functions with their own tests; what can only be checked here is that the
 * switch in Settings actually reaches the thing that writes files.
 */

let h: Harness
const logDir = (): string => join(h.home, 'userdata', 'logs')

test.beforeEach(async () => {
  h = await launchApiary()
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
})

test.afterEach(async () => { await h.close() })

async function openDiagnostics(): Promise<void> {
  await h.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('apiary:open-settings-dialog')
  })
  await expect(h.page.getByTestId('settings-dialog')).toBeVisible()
  await h.page.getByTestId('settings-nav-diagnostics').click()
}

test('is off by default, and writes nothing at all until it is switched on', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await openDiagnostics()

  await expect(h.page.getByTestId('setting-diagnostics-enabled')).not.toBeChecked()
  // Not an empty folder — no folder. A diagnostic feature that creates files by default is one
  // that records things nobody agreed to.
  expect(existsSync(logDir())).toBe(false)
})

test('switching it on starts a log, and the folder is shown and can be emptied', async () => {
  await openDiagnostics()
  await h.page.getByTestId('setting-diagnostics-enabled').check()
  await h.page.getByTestId('settings-save').click()
  await expect(h.page.getByTestId('settings-dialog')).toHaveCount(0)

  // Something worth recording.
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await h.page.getByTestId('resume-button').click()
  await expect(h.page.getByTestId('terminal-session')).toBeVisible()

  await expect.poll(() => existsSync(join(logDir(), 'apiary.log'))).toBe(true)
  const written = readFileSync(join(logDir(), 'apiary.log'), 'utf8')
  // One JSON object per line, and the PTY it started is in there — the kind of fact that decided
  // two earlier bugs.
  const entries = written.trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>)
  expect(entries.every((e) => typeof e.ts === 'string' && typeof e.scope === 'string')).toBe(true)
  expect(entries.some((e) => e.scope === 'pty')).toBe(true)
  // And nobody's home directory anywhere in it. (The fixture's own root is a temp directory, not
  // a home, so this asserts the rule rather than the harness: no `/Users/<name>` or
  // `/home/<name>` survives into a log file.)
  expect(written).not.toMatch(/\/(?:Users|home)\/[^/\s"]+/)

  await openDiagnostics()
  await expect(h.page.getByTestId('log-folder-path')).toHaveText(logDir())
  await expect(h.page.getByTestId('log-folder-size')).toContainText('file')

  await h.page.getByTestId('log-clear').click()
  await expect(h.page.getByTestId('log-folder-size')).toContainText('No log files yet')
  expect(readdirSync(logDir())).toHaveLength(0)
})

test('switching it back off stops the writing', async () => {
  await openDiagnostics()
  await h.page.getByTestId('setting-diagnostics-enabled').check()
  await h.page.getByTestId('settings-save').click()
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await expect.poll(() => existsSync(join(logDir(), 'apiary.log'))).toBe(true)

  await openDiagnostics()
  await h.page.getByTestId('setting-diagnostics-enabled').uncheck()
  await h.page.getByTestId('settings-save').click()
  const after = readFileSync(join(logDir(), 'apiary.log'), 'utf8').length

  // Anything that would have been logged, now that it is off.
  await sidebarSession(h.page, 'Add worktree switcher').click()
  await h.page.getByTestId('sidebar-refresh').click()
  await expectStays(
    () => readFileSync(join(logDir(), 'apiary.log'), 'utf8').length === after,
    1000, 'the log to stay as it was',
  )
})
