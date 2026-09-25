import { describe, it, expect } from 'vitest'
import { page, userEvent } from '@vitest/browser/context'
import { renderApp } from './renderApp'
import type { FakeApiary } from './fakeApiary'
import { until } from './helpers'

/**
 * The updater as the user meets it. The release feed is a fixture (see `fake.state.update`) —
 * what is being tested is the app's side: what appears, what the buttons say on a build that
 * cannot install itself, and that a version dismissed for good stays dismissed.
 */

/** Opens Settings on the Updates section — the menu's channel, in the fake. */
async function openUpdateSettings(fake: FakeApiary): Promise<void> {
  fake.emit('openSettingsDialog')
  await expect.element(page.getByTestId('settings-dialog'), { timeout: 5000 }).toBeVisible()
  await userEvent.click(page.getByTestId('settings-nav-updates'))
}

/** A button's box, read only once it has stopped changing — a mount transition can otherwise be
 *  caught mid-fade and compared against a reference that has already settled. */
async function stableBox(id: string): Promise<{ height: number; background: string }> {
  const read = (): { height: number; background: string } => {
    const el = page.getByTestId(id).element()
    return {
      height: Math.round(el.getBoundingClientRect().height),
      background: getComputedStyle(el).backgroundColor,
    }
  }
  let prev = read()
  await until(() => {
    const cur = read()
    const same = cur.background === prev.background && cur.height === prev.height
    prev = cur
    return same
  })
  return prev
}

describe('the updater', () => {
  it('no update, no banner — the app does not talk about updates it has not found', async () => {
    await renderApp()
    await expect.element(page.getByTestId('update-banner')).not.toBeInTheDocument()
  })

  it('an available update is offered in a strip above the workspace, not a dialog', async () => {
    await renderApp({ update: { phase: 'available', availableVersion: '9.9.9', releaseUrl: 'https://example.invalid/9.9.9' } })
    const banner = page.getByTestId('update-banner')
    await expect.element(banner).toBeVisible()
    await expect.element(banner).toHaveTextContent('9.9.9')
    // Nothing modal: the session underneath is still there to be worked in.
    await expect.element(page.getByTestId('sidebar-refresh')).not.toHaveAttribute('disabled')
  })

  it('the banner\'s buttons are the app\'s own buttons, not the platform\'s', async () => {
    // They used to carry no styling at all, so Chromium drew its native control: white, differently
    // sized, and visibly from another application. The comparison is against a button elsewhere in
    // the app rather than against a hardcoded colour, because the point is that they agree.
    //
    // Deliberately placed before any test in this file performs a real click: a genuine style
    // recomputation those trigger elsewhere in the page can still be settling on the next render,
    // and this is a pixel comparison with no tolerance for that.
    await renderApp({ update: { phase: 'available', availableVersion: '9.9.9', releaseUrl: 'https://example.invalid/9.9.9' } })

    const reference = await stableBox('sidebar-refresh')
    for (const id of ['update-settings', 'update-skip', 'update-notes']) {
      const button = await stableBox(id)
      expect(button.background).toBe(reference.background)
      expect(Math.abs(button.height - reference.height)).toBeLessThanOrEqual(1)
    }

    // The primary action is filled rather than outlined — different on purpose, and the same
    // height as the rest.
    const primary = await stableBox('update-download')
    expect(primary.background).not.toBe(reference.background)
    expect(Math.abs(primary.height - reference.height)).toBeLessThanOrEqual(1)
  })

  it('"Update settings" opens Settings on the Updates section', async () => {
    // The button names the settings it opens, so landing on Sessions — three clicks away from
    // anything it mentions — reads as the button being wired to the wrong thing.
    await renderApp({ update: { phase: 'available', availableVersion: '9.9.9' } })
    await userEvent.click(page.getByTestId('update-settings'))

    await expect.element(page.getByTestId('settings-dialog')).toBeVisible()
    await expect.element(page.getByTestId('settings-nav-updates')).toHaveAttribute('data-active', 'true')
    await expect.element(page.getByTestId('settings-pane')).toHaveTextContent('How Apiary keeps itself up to date')
  })

  it('an unsigned build offers to download, and says why it cannot install by itself', async () => {
    const assistedReason = 'Unsigned build — macOS will not let an app replace itself, so the '
      + 'download opens for you to drag into Applications.'
    const { fake } = await renderApp({
      update: {
        phase: 'available',
        availableVersion: '9.9.9',
        capability: { kind: 'assisted', reason: assistedReason },
      },
    })
    fake.override('updateDownload', async () => {
      fake.state.update = {
        ...fake.state.update,
        phase: 'downloaded',
        downloadedPath: '/tmp/Apiary-9.9.9.dmg',
        install: {
          hint: 'Open it and drag Apiary into Applications to finish updating.',
          command: 'hdiutil attach \'/tmp/Apiary-9.9.9.dmg\' -nobrowse -quiet '
            + '&& cp -R /Volumes/Apiary/Apiary.app /Applications/ && hdiutil detach /Volumes/Apiary -quiet',
          action: 'open',
        },
      }
      fake.emit('updateChanged', fake.state.update)
      return fake.state.update
    })

    const banner = page.getByTestId('update-banner')
    await expect.element(banner.getByTestId('update-download')).toHaveTextContent('Download')
    await expect.element(banner).toHaveTextContent('drag')

    await userEvent.click(banner.getByTestId('update-download'))
    await expect.element(banner).toHaveTextContent('has been downloaded')
    await expect.element(banner.getByTestId('update-open-downloaded')).toBeVisible()
    // It must never offer to restart into an update it cannot install.
    await expect.element(banner.getByTestId('update-install')).not.toBeInTheDocument()
    // A mac .dmg is an assisted platform too — the copy button must not be a .deb-only affordance.
    await expect.element(banner.getByTestId('update-copy-command')).toBeVisible()
  })

  it('a build that can install itself offers to restart into the update', async () => {
    const { fake } = await renderApp({
      update: {
        phase: 'available',
        availableVersion: '9.9.9',
        capability: { kind: 'auto', reason: 'Signed build — updates install themselves.' },
      },
    })
    fake.override('updateDownload', async () => {
      fake.state.update = { ...fake.state.update, phase: 'ready' }
      fake.emit('updateChanged', fake.state.update)
      return fake.state.update
    })

    const banner = page.getByTestId('update-banner')
    await expect.element(banner.getByTestId('update-download')).toHaveTextContent('Download and install')
    await userEvent.click(banner.getByTestId('update-download'))
    await expect.element(banner.getByTestId('update-install')).toBeVisible()
    await expect.element(banner).toHaveTextContent('ready to install')
  })

  it('skipping a version puts the banner away and keeps it away', async () => {
    const { fake } = await renderApp({ update: { phase: 'available', availableVersion: '9.9.9' } })
    // The fake's default `updateSkip` only records the skipped version; the real service also
    // moves the phase back to idle and clears `availableVersion` (see updateService.ts's `skip`),
    // which is what actually makes the banner disappear. Replicated here rather than left to the
    // fake, since the fake's own version is a gap worth fixing there (see report).
    fake.override('updateSkip', async () => {
      const version = fake.state.update.availableVersion
      fake.state.update = { ...fake.state.update, phase: 'idle', availableVersion: null, skippedVersion: version }
      fake.emit('updateChanged', fake.state.update)
    })
    await userEvent.click(page.getByTestId('update-skip'))
    await expect.element(page.getByTestId('update-banner')).not.toBeInTheDocument()

    // A check the user asks for still answers honestly about the skipped version — the skip
    // silences the automatic offer, not the question.
    await openUpdateSettings(fake)
    await userEvent.click(page.getByTestId('update-check-now'))
    await expect.element(page.getByTestId('update-version-row')).toHaveTextContent('Skipping 9.9.9')
  })

  it('dismissing is not skipping: the banner goes, the update is still there', async () => {
    const { fake } = await renderApp({ update: { phase: 'available', availableVersion: '9.9.9' } })
    // Same gap as skip above: the real service's `dismiss` moves the phase to idle without
    // touching `availableVersion`, and a later manual check re-offers it (see updateService.ts).
    fake.override('updateDismiss', async () => {
      fake.state.update = { ...fake.state.update, phase: 'idle', error: null }
      fake.emit('updateChanged', fake.state.update)
    })
    fake.override('updateCheck', async () => {
      fake.state.update = { ...fake.state.update, phase: 'available' }
      fake.emit('updateChanged', fake.state.update)
      return fake.state.update
    })
    await userEvent.click(page.getByTestId('update-dismiss'))
    await expect.element(page.getByTestId('update-banner')).not.toBeInTheDocument()

    await openUpdateSettings(fake)
    await userEvent.click(page.getByTestId('update-check-now'))
    await expect.element(page.getByTestId('update-banner')).toBeVisible()
  })

  it('the Updates settings show the version, the last check, and why installs are manual', async () => {
    const { fake } = await renderApp({
      update: {
        capability: {
          kind: 'assisted',
          reason: 'Unsigned build — macOS will not let an app replace itself, so the download '
            + 'opens for you to drag into Applications.',
        },
      },
    })
    await openUpdateSettings(fake)

    const row = page.getByTestId('update-version-row')
    await expect.element(row).toHaveTextContent('Version')
    await expect.element(row).toHaveTextContent('Last checked')
    // The reason is on screen rather than implied by a missing button.
    await expect.element(row).toHaveTextContent('Unsigned build')
  })

  it('"Check now" answers inside the dialog, where the question was asked', async () => {
    // The banner the pushed status feeds is drawn behind the settings dialog's backdrop, so an
    // answer that only ever appeared there was invisible to whoever pressed the button.
    const { fake } = await renderApp()
    fake.override('updateCheck', async () => ({ ...fake.state.update, phase: 'available', availableVersion: '9.9.9' }))
    await openUpdateSettings(fake)

    await userEvent.click(page.getByTestId('update-check-now'))
    await expect.element(page.getByTestId('update-check-result')).toHaveTextContent('9.9.9 is available')
  })

  it('a check that finds nothing says so, rather than leaving the button silent', async () => {
    // A fixture release older than what is running: the feed answers, and the answer is "no".
    const { fake } = await renderApp()
    fake.override('updateCheck', async () => ({ ...fake.state.update, phase: 'up-to-date', availableVersion: null }))
    await openUpdateSettings(fake)

    await userEvent.click(page.getByTestId('update-check-now'))
    await expect.element(page.getByTestId('update-check-result')).toHaveTextContent('is the latest version')
  })

  it('a build with no updater does not offer a check it cannot run', async () => {
    // Running from source — the case that reported "pressing Check now does nothing". There is no
    // updater at all, so the press was swallowed in the main process and nothing was ever pushed
    // back, which is indistinguishable from a broken button.
    const { fake } = await renderApp({
      update: { capability: { kind: 'unsupported', reason: 'Running from source — updates apply to installed builds only.' } },
    })
    await openUpdateSettings(fake)

    await expect.element(page.getByTestId('update-check-now')).toHaveAttribute('disabled')
    await expect.element(page.getByTestId('update-version-row')).toHaveTextContent('updates apply to installed builds only')
  })

  it('a downloaded .deb says how to install it, rather than talking about Applications', async () => {
    // On Ubuntu the banner used to read "Open it and drag Apiary into Applications" beside a button
    // that could not open a .deb at all — `shell.openPath` on one reports success and does nothing.
    const { fake } = await renderApp({
      update: {
        phase: 'available',
        availableVersion: '9.9.9',
        capability: {
          kind: 'assisted',
          reason: 'Installing a .deb needs root, so Apiary offers the file rather than trying itself.',
        },
      },
    })
    fake.override('updateDownload', async () => {
      fake.state.update = {
        ...fake.state.update,
        phase: 'downloaded',
        downloadedPath: '/tmp/apiary_9.9.9_amd64.deb',
        install: {
          hint: 'Installing a .deb needs root, so Apiary cannot do it for you. Run this to finish:',
          command: 'sudo apt install \'/tmp/apiary_9.9.9_amd64.deb\'',
          action: 'reveal',
        },
      }
      fake.emit('updateChanged', fake.state.update)
      return fake.state.update
    })
    await userEvent.click(page.getByTestId('update-download'))

    const banner = page.getByTestId('update-banner')
    await expect.element(banner).toHaveAttribute('data-phase', 'downloaded')
    await expect.element(banner).toHaveTextContent('root')
    await expect.element(banner).not.toHaveTextContent('Applications')
    // And the button says what it will actually do.
    await expect.element(page.getByTestId('update-open-downloaded')).toHaveTextContent('Show in folder')
    await expect.element(page.getByTestId('update-copy-command')).toBeVisible()
  })
})
