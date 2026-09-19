import { test, expect } from '@playwright/test'
import { launchApiary, importAll, type Harness } from './helpers'

/**
 * The updater as the user meets it. The release feed is a fixture (see `fakeUpdate` in helpers) —
 * what is being tested is the app's side: what appears, what the buttons say on a build that
 * cannot install itself, and that a version dismissed for good stays dismissed.
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

/**
 * Runs the check the "Check for Updates" menu item runs.
 *
 * The scheduled one deliberately waits half a minute after launch so it is not competing with
 * startup, which is far longer than a test should sit still for — and a manual check is the same
 * code path with `manual: true`, which is what the menu item does anyway.
 */
async function checkNow(): Promise<void> {
  await h.page.evaluate(() => window.apiary.updateCheck())
}

test('no update, no banner — the app does not talk about updates it has not found', async () => {
  await launch()
  await expect(h.page.getByTestId('update-banner')).toHaveCount(0)
})

test('an available update is offered in a strip above the workspace, not a dialog', async () => {
  await launch({ fakeUpdate: '9.9.9' })
  await checkNow()
  const banner = h.page.getByTestId('update-banner')
  await expect(banner).toBeVisible()
  await expect(banner).toContainText('9.9.9')
  // Nothing modal: the session underneath is still there to be worked in.
  await expect(h.page.getByTestId('sidebar-refresh')).toBeEnabled()
})

test('"Update settings" opens Settings on the Updates section', async () => {
  // The button names the settings it opens, so landing on Sessions — three clicks away from
  // anything it mentions — reads as the button being wired to the wrong thing.
  await launch({ fakeUpdate: '9.9.9' })
  await checkNow()
  await h.page.getByTestId('update-settings').click()

  await expect(h.page.getByTestId('settings-dialog')).toBeVisible()
  await expect(h.page.getByTestId('settings-nav-updates')).toHaveAttribute('data-active', 'true')
  await expect(h.page.getByTestId('settings-pane')).toContainText('How Apiary keeps itself up to date')
})

test('the banner\'s buttons are the app\'s own buttons, not the platform\'s', async () => {
  // They used to carry no styling at all, so Chromium drew its native control: white, differently
  // sized, and visibly from another application. The comparison is against a button elsewhere in
  // the app rather than against a hardcoded colour, because the point is that they agree.
  await launch({ fakeUpdate: '9.9.9' })
  await checkNow()

  const box = async (id: string): Promise<{ height: number; background: string }> =>
    h.page.getByTestId(id).evaluate((el) => ({
      height: Math.round(el.getBoundingClientRect().height),
      background: getComputedStyle(el).backgroundColor,
    }))

  const reference = await box('sidebar-refresh')
  for (const id of ['update-settings', 'update-skip', 'update-notes']) {
    const button = await box(id)
    expect(button.background).toBe(reference.background)
    expect(Math.abs(button.height - reference.height)).toBeLessThanOrEqual(1)
  }

  // The primary action is filled rather than outlined — different on purpose, and the same
  // height as the rest.
  const primary = await box('update-download')
  expect(primary.background).not.toBe(reference.background)
  expect(Math.abs(primary.height - reference.height)).toBeLessThanOrEqual(1)
})

test('an unsigned build offers to download, and says why it cannot install by itself', async () => {
  await launch({ fakeUpdate: '9.9.9', updateMode: 'assisted' })
  await checkNow()
  const banner = h.page.getByTestId('update-banner')

  await expect(banner.getByTestId('update-download')).toHaveText('Download')
  await expect(banner).toContainText('drag')

  await banner.getByTestId('update-download').click()
  await expect(banner).toContainText('has been downloaded')
  await expect(banner.getByTestId('update-open-downloaded')).toBeVisible()
  // It must never offer to restart into an update it cannot install.
  await expect(banner.getByTestId('update-install')).toHaveCount(0)
  // A mac .dmg is an assisted platform too — the copy button must not be a .deb-only affordance.
  await expect(banner.getByTestId('update-copy-command')).toBeVisible()
})

test('a build that can install itself offers to restart into the update', async () => {
  await launch({ fakeUpdate: '9.9.9', updateMode: 'auto' })
  await checkNow()
  const banner = h.page.getByTestId('update-banner')

  await expect(banner.getByTestId('update-download')).toHaveText('Download and install')
  await banner.getByTestId('update-download').click()
  await expect(banner.getByTestId('update-install')).toBeVisible()
  await expect(banner).toContainText('ready to install')
})

test('skipping a version puts the banner away and keeps it away', async () => {
  await launch({ fakeUpdate: '9.9.9' })
  await checkNow()
  const banner = h.page.getByTestId('update-banner')
  await banner.getByTestId('update-skip').click()
  await expect(banner).toHaveCount(0)

  // A check the user asks for still answers honestly about the skipped version — the skip
  // silences the automatic offer, not the question.
  await openUpdateSettings()
  await h.page.getByTestId('update-check-now').click()
  await expect(h.page.getByTestId('update-version-row')).toContainText('Skipping 9.9.9')
})

test('dismissing is not skipping: the banner goes, the update is still there', async () => {
  await launch({ fakeUpdate: '9.9.9' })
  await checkNow()
  await h.page.getByTestId('update-dismiss').click()
  await expect(h.page.getByTestId('update-banner')).toHaveCount(0)

  await openUpdateSettings()
  await h.page.getByTestId('update-check-now').click()
  await expect(h.page.getByTestId('update-banner')).toBeVisible()
})

test('the Updates settings show the version, the last check, and why installs are manual', async () => {
  await launch({ fakeUpdate: '9.9.9' })
  await openUpdateSettings()

  const row = h.page.getByTestId('update-version-row')
  await expect(row).toContainText('Version')
  await expect(row).toContainText('Last checked')
  // The reason is on screen rather than implied by a missing button.
  await expect(row).toContainText('Unsigned build')
})

test('"Check now" answers inside the dialog, where the question was asked', async () => {
  // The banner the pushed status feeds is drawn behind the settings dialog's backdrop, so an
  // answer that only ever appeared there was invisible to whoever pressed the button.
  await launch({ fakeUpdate: '9.9.9' })
  await openUpdateSettings()

  await h.page.getByTestId('update-check-now').click()
  await expect(h.page.getByTestId('update-check-result')).toContainText('9.9.9 is available')
})

test('a check that finds nothing says so, rather than leaving the button silent', async () => {
  // A fixture release older than what is running: the feed answers, and the answer is "no".
  await launch({ fakeUpdate: '0.0.1' })
  await openUpdateSettings()

  await h.page.getByTestId('update-check-now').click()
  await expect(h.page.getByTestId('update-check-result')).toContainText('is the latest version')
})

test('a build with no updater does not offer a check it cannot run', async () => {
  // Running from source — the case that reported "pressing Check now does nothing". There is no
  // updater at all, so the press was swallowed in the main process and nothing was ever pushed
  // back, which is indistinguishable from a broken button.
  await launch()
  await openUpdateSettings()

  await expect(h.page.getByTestId('update-check-now')).toBeDisabled()
  await expect(h.page.getByTestId('update-version-row')).toContainText('updates apply to installed builds only')
})

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

test('a downloaded .deb says how to install it, rather than talking about Applications', async () => {
  // On Ubuntu the banner used to read "Open it and drag Apiary into Applications" beside a button
  // that could not open a .deb at all — `shell.openPath` on one reports success and does nothing.
  await launch({ fakeUpdate: '9.9.9', updateMode: 'deb' })
  await checkNow()
  await h.page.getByTestId('update-download').click()

  const banner = h.page.getByTestId('update-banner')
  await expect(banner).toHaveAttribute('data-phase', 'downloaded')
  await expect(banner).toContainText('root')
  await expect(banner).not.toContainText('Applications')
  // And the button says what it will actually do.
  await expect(h.page.getByTestId('update-open-downloaded')).toHaveText('Show in folder')
  await expect(h.page.getByTestId('update-copy-command')).toBeVisible()
})
