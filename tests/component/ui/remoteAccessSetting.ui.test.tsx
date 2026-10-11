import { describe, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from '../renderApp'
import { until } from '../helpers'
import type { RemoteClientInfo } from '@shared/domain/remote'
import type { FakeOptions } from '../fakeApiary'
import { reviewUi } from './review'

/** Settings → General with "Allow remote access over SSH" off, and on. */
async function openGeneral(
  remoteAccess: boolean, more: NonNullable<FakeOptions['settings']> = {}, clients: RemoteClientInfo[] = [],
): Promise<void> {
  const { fake } = await renderApp({ settings: { remoteAccess, ...more } })
  fake.state.remoteClients = clients
  fake.emit('openSettingsDialog')
  await until(() => document.querySelector('[data-testid="settings-dialog"]') !== null)
  await userEvent.click(page.getByTestId('settings-nav-general'))
  await until(() => document.querySelector('[data-testid="setting-remote-access"]') !== null)
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

  it('remote access setting asking to disconnect all', async () => {
    await openGeneral(true, {}, CLIENTS)
    await until(() => document.querySelector('[data-testid="remote-disconnect-all"]') !== null)
    await userEvent.click(page.getByTestId('remote-disconnect-all'))
    document.querySelector('[data-testid="remote-disconnect-confirm"]')?.scrollIntoView({ block: 'end' })
    await reviewUi('remote access setting disconnect all confirm', { widths: [620, 900] })
  })
})
