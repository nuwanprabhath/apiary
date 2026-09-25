import { test, expect } from '@playwright/test'
import { launchApiary, importAll, type Harness } from './helpers'

/**
 * The updater as the user meets it. The release feed is a fixture (see `fakeUpdate` in helpers) —
 * what is being tested is the app's side: what appears, what the buttons say on a build that
 * cannot install itself, and that a version dismissed for good stays dismissed.
 *
 * Everything that does not depend on a real settings save surviving a relaunch has moved to
 * tests/component/update.test.tsx, driven against the fake `window.apiary` instead of a real
 * Electron launch. What is left here is the two tests that specifically prove a setting written to
 * disk is read back after the process restarts — that is not something a component test, which
 * never quits, can prove.
 */

let h: Harness

test.afterEach(async () => { await h.close() })

/** The menu lives in the main process, so trigger the same channel it sends. */
async function openSettings(): Promise<void> {
  await h.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('apiary:open-settings-dialog')
  })
  await expect(h.page.getByTestId('settings-dialog')).toBeVisible()
}

/** Opens Settings on the Updates section. */
async function openUpdateSettings(): Promise<void> {
  await openSettings()
  await h.page.getByTestId('settings-nav-updates').click()
}

async function launch(opts: Parameters<typeof launchApiary>[0] = {}): Promise<void> {
  h = await launchApiary(opts)
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
}

test('turning automatic checks off hides the interval, and the choice survives a reopen', async () => {
  await launch({ fakeUpdate: '9.9.9' })
  await openUpdateSettings()

  await expect(h.page.getByTestId('setting-update-interval')).toBeVisible()
  await h.page.getByTestId('setting-update-automatic').uncheck()
  await expect(h.page.getByTestId('setting-update-interval')).toHaveCount(0)

  await h.page.getByTestId('settings-save').click()
  await openUpdateSettings()
  await expect(h.page.getByTestId('setting-update-automatic')).not.toBeChecked()
})

test('the check interval can be set from a preset', async () => {
  await launch({ fakeUpdate: '9.9.9' })
  await openUpdateSettings()

  await h.page.getByTestId('setting-update-preset-24').click()
  await expect(h.page.getByTestId('setting-update-interval')).toHaveValue('24')

  await h.page.getByTestId('settings-save').click()
  await openUpdateSettings()
  await expect(h.page.getByTestId('setting-update-interval')).toHaveValue('24')
})
