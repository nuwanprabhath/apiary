import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { launchApiary, importAll, sidebarSession } from '../e2e/helpers'

/**
 * Packaged-app smoke (TEST-7). Run with `npm run test:packaged`, never by the default suite.
 *
 * Proves what no unpackaged run can: the asar layout works. node-pty's native module loads from
 * app.asar.unpacked and its spawn-helper is executable (a shell spawns and echoes), the fixture
 * sessions are scanned into the database (better-sqlite3 loads), and the app quits cleanly.
 *
 * Launches through the e2e harness against a throwaway HOME, CLAUDE_CONFIG_DIR and --user-data-dir.
 * A packaged app ignores the APIARY_* test hooks by design, so isolation rests on those three, and
 * the window is visible (no headless mode) for the few seconds the run takes. No native dialog is
 * reachable: nothing here opens a picker, and the macOS crash dialog is guarded by codesign.
 */

const app = process.env.APIARY_PACKAGED_APP

/** The executable inside a packaged app directory/bundle, or null when it is not there. */
function executableOf(path: string): string | null {
  const exe = process.platform === 'darwin' ? join(path, 'Contents', 'MacOS', 'Apiary') : path
  return existsSync(exe) ? resolve(exe) : null
}

/**
 * macOS kills an app whose signature does not match its content at launch and shows a crash
 * dialog on the user's screen, so the bundle must verify before it is ever launched. Returns the
 * reason to skip, or null when it is safe to launch.
 */
function unsafeToLaunch(path: string): string | null {
  if (process.platform !== 'darwin') return null
  try {
    execFileSync('codesign', ['--verify', '--deep', '--strict', path], { stdio: 'pipe' })
    return null
  } catch (e) {
    const detail = e instanceof Error ? e.message.split('\n').slice(0, 2).join(' ') : String(e)
    return `codesign --verify --deep --strict failed for ${path} (${detail}); refusing to launch an app macOS may crash`
  }
}

test.skip(app === undefined || app === '', 'APIARY_PACKAGED_APP is not set; run `npm run test:packaged`')

test('the packaged app boots, lists sessions, spawns a shell, and quits cleanly', async () => {
  const exe = executableOf(app ?? '')
  test.skip(exe === null, `no packaged executable at ${String(app)}`)
  const reason = unsafeToLaunch(app ?? '')
  test.skip(reason !== null, reason ?? '')

  process.env.APIARY_E2E_EXECUTABLE = exe ?? ''
  const h = await launchApiary()
  try {
    await expect(h.page.getByTestId('sidebar')).toBeVisible()

    await importAll(h.page)
    await h.page.getByTestId('sidebar-refresh').click()
    await expect(sidebarSession(h.page, 'Fix CSV export bug')).toBeVisible()
    await expect(sidebarSession(h.page, 'Add worktree switcher')).toBeVisible()

    await sidebarSession(h.page, 'Fix CSV export bug').click()
    await h.page.getByTestId('shell-toggle').click()
    await expect(h.page.getByTestId('terminal-shell')).toBeVisible()
    await h.page.getByTestId('terminal-shell').click()
    await h.page.keyboard.type('echo $((6*7))_PACKAGED_OK\n')
    await expect(h.page.getByTestId('terminal-shell')).toContainText('42_PACKAGED_OK', { timeout: 30000 })

    // A clean quit: the app must be gone shortly after close(); one that lingers is killed by the
    // harness (and reported), but is a failure here.
    const proc = h.app.process()
    await h.close()
    expect(proc.exitCode !== null || proc.signalCode !== null, 'the packaged app exited after quitting').toBe(true)
  } finally {
    delete process.env.APIARY_E2E_EXECUTABLE
  }
})
