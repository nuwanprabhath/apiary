import { test, expect } from '@playwright/test'
import { launchApiary, relaunchApiary, type Harness } from './helpers'

/** The menu lives in the main process, so trigger the same channel it sends. */
async function openSettings(h: Harness): Promise<void> {
  await h.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('apiary:open-settings-dialog')
  })
  await expect(h.page.getByTestId('settings-dialog')).toBeVisible()
}

async function openImport(h: Harness): Promise<void> {
  await h.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('apiary:open-import-dialog')
  })
  await expect(h.page.getByTestId('import-dialog')).toBeVisible()
}

let h: Harness
test.beforeEach(async () => { h = await launchApiary() })
test.afterEach(async () => { await h.close() })

test('settings are organised into sections, and the section you pick is the one you see', async () => {
  await openSettings(h)
  // Sessions first, since that is what the app is for.
  await expect(h.page.getByTestId('settings-pane')).toContainText('Automatically import all sessions')
  await expect(h.page.getByTestId('claude-bin-input')).toHaveCount(0)

  await h.page.getByTestId('settings-nav-general').click()
  await expect(h.page.getByTestId('claude-bin-input')).toBeVisible()
  await expect(h.page.getByTestId('settings-pane')).not.toContainText('Automatically import all sessions')
})

test('Escape closes the settings dialog', async () => {
  await openSettings(h)
  await h.page.keyboard.press('Escape')
  await expect(h.page.getByTestId('settings-dialog')).toHaveCount(0)
})

test('turning on "import all sessions" fills the sidebar without opening the import dialog', async () => {
  // Nothing is imported to begin with — that is the whole premise of the import step.
  await expect(h.page.getByTestId('sidebar-empty')).toBeVisible()

  await openSettings(h)
  await h.page.getByTestId('setting-auto-import-all').check()
  await h.page.getByTestId('settings-save').click()
  await expect(h.page.getByTestId('settings-dialog')).toHaveCount(0)

  // Applied immediately, with no restart and no trip through the import dialog.
  await expect(h.page.getByTestId('session-item')).toHaveCount(4, { timeout: 15000 })
})

test('with auto-import on, the import dialog says so instead of offering an empty choice', async () => {
  await openSettings(h)
  await h.page.getByTestId('setting-auto-import-all').check()
  await h.page.getByTestId('settings-save').click()
  await expect(h.page.getByTestId('session-item')).toHaveCount(4, { timeout: 15000 })

  await openImport(h)
  await expect(h.page.getByTestId('import-auto-notice')).toBeVisible()
  await expect(h.page.getByTestId('import-auto-notice')).toContainText(/Settings/i)
})

test('a session created after startup is imported on its own while auto-import is on', async () => {
  await openSettings(h)
  await h.page.getByTestId('setting-auto-import-all').check()
  await h.page.getByTestId('settings-save').click()
  await expect(h.page.getByTestId('session-item')).toHaveCount(4, { timeout: 15000 })

  // Exactly the reported case: a session started in a terminal outside the app.
  const { makeSession } = await import('../fixtures/makeSession')
  makeSession(h.projectsRoot, '-work-a', {
    sessionId: '88888888-8888-8888-8888-888888888888',
    cwd: h.workdir,
    title: 'Started outside Apiary',
  })

  // The Refresh button rescans, and with this setting on a rescan imports what it finds.
  await h.page.getByTestId('sidebar-refresh').click()
  await expect(h.page.getByTestId('session-item')).toHaveCount(5, { timeout: 15000 })
})

test('the session settings survive a relaunch', async () => {
  await openSettings(h)
  await h.page.getByTestId('setting-auto-import-all').check()
  await h.page.getByTestId('setting-auto-import-interval-enabled').check()
  await h.page.getByTestId('setting-interval-preset-15').click()
  await h.page.getByTestId('settings-save').click()
  await expect(h.page.getByTestId('settings-dialog')).toHaveCount(0)

  await relaunchApiary(h)
  await openSettings(h)
  await expect(h.page.getByTestId('setting-auto-import-all')).toBeChecked()
  await expect(h.page.getByTestId('setting-auto-import-interval-enabled')).toBeChecked()
  await expect(h.page.getByTestId('setting-auto-import-interval')).toHaveValue('15')
})

test('the periodic check is off unless it is switched on, and its interval only then appears', async () => {
  await openSettings(h)
  // Off by default: a scan shells out to git once per project, so it is not free.
  await expect(h.page.getByTestId('setting-auto-import-interval-enabled')).not.toBeChecked()
  await expect(h.page.getByTestId('setting-auto-import-interval')).toHaveCount(0)

  await h.page.getByTestId('setting-auto-import-interval-enabled').check()
  await expect(h.page.getByTestId('setting-auto-import-interval')).toBeVisible()
})
