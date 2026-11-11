import { afterEach, describe, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from '../renderApp'
import { until } from '../helpers'
import type { UpdateStatusPayload } from '@shared/api'
import { PASSWORD_NOT_ACCEPTED } from '@shared/domain/update'
import { reviewUi, type ReviewOptions } from './review'

/** Every state of the update banner's Install and restart, at 620 / 900 / 1400 in every theme. */

const OFFER: Partial<UpdateStatusPayload> = { phase: 'available', availableVersion: '1.51.0', currentVersion: '1.50.0', releaseUrl: 'https://example.invalid/1.51.0' }
const DEB = '/fixture/apiary_1.51.0_amd64.deb'
const SHOWN: ReviewOptions = {
  widths: [900, 1400],
  open: async () => { await until(() => document.querySelector('[data-testid="update-banner"]') !== null) },
}

afterEach(() => { history.replaceState(null, '', location.pathname) })

async function render(update: Partial<UpdateStatusPayload>): Promise<void> {
  await renderApp({ update: { ...OFFER, ...update } })
}

describe('UI: update banner, Install and restart', () => {
  it('available', async () => {
    await render({})
    await reviewUi('update available install and restart', SHOWN)
  })

  it('installing, with progress', async () => {
    await render({ phase: 'downloading', installRequested: true, progressPercent: 62 })
    await reviewUi('update installing progress', SHOWN)
  })

  it('password prompt', async () => {
    await render({ phase: 'needs-password', installRequested: true, downloadedPath: DEB })
    await reviewUi('update password prompt', SHOWN)
  })

  it('password refused', async () => {
    await render({ phase: 'needs-password', installRequested: true, downloadedPath: DEB, installError: PASSWORD_NOT_ACCEPTED })
    await reviewUi('update password refused', SHOWN)
  })

  it('install failed, with the fallback', async () => {
    await render({
      phase: 'downloaded', installRequested: true, downloadedPath: DEB,
      install: { hint: 'To install it yourself, run:', command: `sudo apt install '${DEB}'`, action: 'reveal' },
      installError: 'E: Sub-process /usr/bin/dpkg returned an error code (1)',
    })
    await reviewUi('update install failed', SHOWN)
  })

  it('restarting', async () => {
    await render({ phase: 'restarting', installRequested: true })
    await reviewUi('update restarting', SHOWN)
  })

  it('a remote window asking for the work machine\'s password', async () => {
    history.replaceState(null, '', `${location.pathname}?chrome=custom&remote=nuwan-hp`)
    await renderApp({ update: OFFER, updateSudo: { password: 'hunter2' } })
    await reviewUi('update remote password prompt', {
      widths: [900, 1400],
      open: async () => {
        await userEvent.click(page.getByTestId('update-install-restart'))
        await until(() => document.querySelector('[data-testid="update-password"]') !== null)
      },
      close: async () => {
        await userEvent.click(page.getByTestId('update-password-cancel'))
        await until(() => document.querySelector('[data-testid="update-install-restart"]') !== null)
      },
    })
  })

  it('a newer version is installed: restart to use it', async () => {
    await render({ phase: 'idle', availableVersion: null, installedVersion: '1.51.0' })
    await reviewUi('update installed restart', SHOWN)
  })
})
