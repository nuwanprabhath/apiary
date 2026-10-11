import { describe, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from '../renderApp'
import { until } from '../helpers'
import type { RemoteClientInfo } from '@shared/domain/remote'
import type { FakeApiary, FakeOptions } from '../fakeApiary'
import { reviewUi } from './review'

/** Settings → General with "Allow remote access over SSH" off, and on. */
async function openGeneral(
  remoteAccess: boolean, more: NonNullable<FakeOptions['settings']> = {}, clients: RemoteClientInfo[] = [],
  arrange: (fake: FakeApiary) => void = () => undefined,
): Promise<void> {
  const { fake } = await renderApp({ settings: { remoteAccess, ...more } })
  fake.state.remoteClients = clients
  arrange(fake)
  fake.emit('openSettingsDialog')
  await until(() => document.querySelector('[data-testid="settings-dialog"]') !== null)
  await userEvent.click(page.getByTestId('settings-nav-general'))
  await until(() => document.querySelector('[data-testid="setting-remote-access"]') !== null)
}

/** Scrolls the failure line under `testId` to the bottom of the General pane, after each resize (which resets the scroll). */
const showAlert = (testId: string) => async (): Promise<void> => {
  const el = document.querySelector(`[data-testid="${testId}"] [role="alert"]`) ?? document.querySelector(`[data-testid="${testId}"]`)
  el?.scrollIntoView({ block: 'end' })
  await Promise.resolve()
}

// Tall enough that the General pane, now five rows long, fits without scrolling: the audit reads
// the rows a scrolling pane hides behind its header as overlapping it.

describe('UI: the remote access setting', () => {
  it('remote access setting off', async () => {
    await openGeneral(false)
    await reviewUi('remote access setting off', { widths: [620, 900] })
  })

  it('remote access setting on', async () => {
    await openGeneral(true)
    await reviewUi('remote access setting on', { widths: [620, 900] })
  })

  it('remote access setting refused: another Apiary serves it', async () => {
    await openGeneral(true, {}, [], (fake) => {
      fake.state.remoteServerState = { state: 'failed', message: 'Another Apiary on this computer already serves remote access.' }
    })
    await until(() => document.querySelector('[data-testid="remote-server-failure"]') !== null)
    await reviewUi('remote access setting refused', { widths: [620, 900], open: showAlert('remote-server-failure') })
  })

  const CLIENTS: RemoteClientInfo[] = [
    { id: 'a', client: 'home-mac', connectedAt: new Date(2026, 9, 10, 10, 12).getTime(), windows: 2 },
    { id: 'b', client: 'a-very-long-laptop-name-from-the-corporate-network.example.com', connectedAt: new Date(2026, 9, 10, 11, 3).getTime(), windows: 1 },
  ]

  it('remote access setting with clients connected and a pairing code', async () => {
    await openGeneral(true, { remoteAccessPairing: true }, CLIENTS)
    await until(() => document.querySelector('[data-testid="remote-pairing-code"]')?.textContent === 'KMNP-2345')
    document.querySelector('[data-testid="remote-clients"]')?.scrollIntoView({ block: 'end' })
    await reviewUi('remote access setting with clients and pairing code', { widths: [620, 900] })
  })

  it('remote access setting pairing code could not be loaded', async () => {
    await openGeneral(true, { remoteAccessPairing: true }, [], (fake) => {
      fake.override('remotePairing', async () => { throw new Error('Pairing codes are not available here.') })
    })
    await until(() => document.querySelector('[data-testid="remote-pairing-load-error"]') !== null)
    await reviewUi('remote access setting pairing code not loaded', { widths: [620, 900], height: 1300, open: showAlert('remote-pairing-load-error') })
  })

  it('remote access setting new code failed', async () => {
    await openGeneral(true, { remoteAccessPairing: true }, [], (fake) => {
      fake.override('remotePairingNew', async () => { throw new Error('Pairing codes are not available here.') })
    })
    await until(() => document.querySelector('[data-testid="remote-pairing-code"]')?.textContent === 'KMNP-2345')
    await userEvent.click(page.getByTestId('remote-pairing-new'))
    await until(() => document.querySelector('[data-testid="remote-pairing"] [role="alert"]') !== null)
    await reviewUi('remote access setting new code failed', { widths: [620, 900], height: 1300, open: showAlert('remote-pairing') })
  })

  it('remote access setting disconnect all failed', async () => {
    await openGeneral(true, {}, CLIENTS, (fake) => {
      fake.override('remoteDisconnectAll', async () => { throw new Error('Could not close the connections: the server is not running.') })
    })
    await until(() => document.querySelector('[data-testid="remote-disconnect-all"]') !== null)
    await userEvent.click(page.getByTestId('remote-disconnect-all'))
    await userEvent.click(page.getByTestId('remote-disconnect-yes'))
    await until(() => document.querySelector('[data-testid="remote-clients"] [role="alert"]') !== null)
    await reviewUi('remote access setting disconnect all failed', { widths: [620, 900], height: 1300, open: showAlert('remote-clients') })
  })

  it('remote access setting asking to disconnect all', async () => {
    await openGeneral(true, {}, CLIENTS)
    await until(() => document.querySelector('[data-testid="remote-disconnect-all"]') !== null)
    await userEvent.click(page.getByTestId('remote-disconnect-all'))
    document.querySelector('[data-testid="remote-disconnect-confirm"]')?.scrollIntoView({ block: 'end' })
    await reviewUi('remote access setting disconnect all confirm', { widths: [620, 900] })
  })
})
