import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import type { RemoteClientInfo } from '@shared/domain/remote'
import { renderApp } from './renderApp'
import type { FakeApiary } from './fakeApiary'
import { until } from './helpers'

const text = (id: string): string | null => document.querySelector(`[data-testid="${id}"]`)?.textContent ?? null
const present = (id: string): boolean => document.querySelector(`[data-testid="${id}"]`) !== null

async function openGeneral(fake: FakeApiary): Promise<void> {
  fake.emit('openSettingsDialog')
  await until(() => present('settings-dialog'))
  await userEvent.click(page.getByTestId('settings-nav-general'))
  await until(() => present('setting-remote-access'))
}

const CLIENT: RemoteClientInfo = { id: 'c1', client: 'home-mac', connectedAt: new Date(2026, 9, 10, 10, 12).getTime(), windows: 2 }

describe('Settings → General → remote access, on the work machine', () => {
  it('lists nobody and offers no Disconnect all while nobody is connected', async () => {
    const { fake } = await renderApp()
    await openGeneral(fake)
    expect(present('remote-clients')).toBe(false)
    expect(present('remote-disconnect-all')).toBe(false)
  })

  it('lists who is connected now, as they come and go', async () => {
    const { fake } = await renderApp({ settings: { remoteAccess: true } })
    fake.state.remoteClients = [CLIENT]
    await openGeneral(fake)
    await until(() => present('remote-client'))
    expect(text('remote-client')).toMatch(/^Connected now: home-mac \(since \d{1,2}:12/)
    fake.emit('remoteClientsChanged', [CLIENT, { ...CLIENT, id: 'c2', client: 'laptop' }])
    await until(() => document.querySelectorAll('[data-testid="remote-client"]').length === 2)
    fake.emit('remoteClientsChanged', [])
    await until(() => !present('remote-clients'))
  })

  it('asks before disconnecting, in words that say remote access goes off, and Keep changes nothing', async () => {
    const { fake } = await renderApp({ settings: { remoteAccess: true } })
    fake.state.remoteClients = [CLIENT]
    await openGeneral(fake)
    await until(() => present('remote-disconnect-all'))
    await userEvent.click(page.getByTestId('remote-disconnect-all'))
    expect(text('remote-disconnect-confirm')).toContain(
      'Disconnect home-mac and turn remote access off? Turn it back on here to allow connections again.',
    )
    await userEvent.click(page.getByTestId('remote-disconnect-no'))
    expect(present('remote-disconnect-confirm')).toBe(false)
    expect(fake.state.remoteDisconnects).toBe(0)
  })

  it('Disconnect all closes the connections and unticks "Allow remote access", so Save cannot turn it back on', async () => {
    const { fake } = await renderApp({ settings: { remoteAccess: true } })
    fake.state.remoteClients = [CLIENT]
    await openGeneral(fake)
    await until(() => present('remote-disconnect-all'))
    await userEvent.click(page.getByTestId('remote-disconnect-all'))
    await userEvent.click(page.getByTestId('remote-disconnect-yes'))
    await until(() => fake.state.remoteDisconnects === 1)
    await until(() => !present('remote-clients'))
    expect(document.querySelector<HTMLInputElement>('[data-testid="setting-remote-access"]')?.checked).toBe(false)
    await userEvent.click(page.getByRole('button', { name: 'Save' }))
    await until(() => !present('settings-dialog'))
    expect(fake.state.settings.remoteAccess).toBe(false)
  })

  it('shows the pairing code with Copy and New code only while "Also require a pairing code" is on', async () => {
    const { fake } = await renderApp()
    await openGeneral(fake)
    expect(present('remote-pairing')).toBe(false)
    await userEvent.click(page.getByTestId('setting-remote-pairing'))
    await until(() => text('remote-pairing-code') === 'KMNP-2345')
    expect(present('remote-pairing-copy')).toBe(true)
    expect(present('remote-pairing-new')).toBe(true)
    await userEvent.click(page.getByTestId('setting-remote-pairing'))
    expect(present('remote-pairing')).toBe(false)
  })

  it('copies the code, and "New code" replaces it', async () => {
    const { fake } = await renderApp({ settings: { remoteAccessPairing: true } })
    await openGeneral(fake)
    await until(() => text('remote-pairing-code') === 'KMNP-2345')
    await userEvent.click(page.getByTestId('remote-pairing-copy'))
    await until(() => text('remote-pairing-copy') === 'Copied')
    expect(fake.callsTo('copyToClipboard')).toEqual([['KMNP-2345']])
    await userEvent.click(page.getByTestId('remote-pairing-new'))
    await until(() => text('remote-pairing-code') === 'WXYZ-6789')
    expect(text('remote-pairing-copy')).toBe('Copy')
  })
})
