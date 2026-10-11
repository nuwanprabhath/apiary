import { afterEach, describe, expect, it } from 'vitest'
import { pairingErrorMessage, type RemoteHost } from '@shared/domain/remote'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { stays, until } from './helpers'
import type { FakeApiary } from './fakeApiary'
import { fakePet } from './fake/pets'

const dialog = (): Element | null => document.querySelector('[data-testid="remote-dialog"]')
const field = (): HTMLInputElement => {
  const input = document.querySelector<HTMLInputElement>('[data-testid="remote-host"]')
  if (input === null) throw new Error('the connect dialog is not open')
  return input
}
const connectButton = (): HTMLButtonElement => {
  const button = document.querySelector<HTMLButtonElement>('[data-testid="remote-connect"]')
  if (button === null) throw new Error('the connect dialog is not open')
  return button
}

async function openDialog(fake: FakeApiary): Promise<void> {
  fake.emit('openRemoteDialog')
  await until(() => dialog() !== null)
}

/** Mounts the app as main opens a remote window: with `remote=<host>` (and a custom bar) in its URL. */
async function renderRemote(host: string): ReturnType<typeof renderApp> {
  history.replaceState(null, '', `${location.pathname}?chrome=custom&remote=${host}`)
  return renderApp()
}

afterEach(() => { history.replaceState(null, '', location.pathname) })

describe('the connect dialog', () => {
  it('opens on the openRemoteDialog event', async () => {
    const { fake } = await renderApp()
    expect(dialog()).toBeNull()
    await openDialog(fake)
    await expect.element(page.getByText('Connect to Remote Host')).toBeVisible()
  })

  it('connects with the host and closes', async () => {
    const { fake } = await renderApp()
    await openDialog(fake)
    await userEvent.fill(page.getByTestId('remote-host'), 'dev@10.0.0.4')
    await userEvent.keyboard('{Enter}')
    await until(() => dialog() === null)
    expect(fake.state.remoteConnects).toEqual(['dev@10.0.0.4'])
  })

  it('shows a failure in full and keeps the host in the field', async () => {
    const { fake } = await renderApp()
    fake.state.remoteConnectError = 'ssh: connect to host work-box port 22: Connection refused\nNo route to host'
    await openDialog(fake)
    await userEvent.fill(page.getByTestId('remote-host'), 'work-box')
    await userEvent.click(page.getByTestId('remote-connect'))
    await until(() => document.querySelector('[data-testid="remote-error"]') !== null)
    expect(document.querySelector('[data-testid="remote-error"]')?.textContent).toContain('Connection refused')
    expect(document.querySelector('[data-testid="remote-error"]')?.textContent).toContain('No route to host')
    expect(field().value).toBe('work-box')
    expect(dialog()).not.toBeNull()
    expect(connectButton().disabled).toBe(false)
  })

  it('disables Connect for an invalid host and says what a host is', async () => {
    const { fake } = await renderApp()
    await openDialog(fake)
    expect(connectButton().disabled).toBe(true)
    await userEvent.fill(page.getByTestId('remote-host'), '-oProxyCommand=evil')
    expect(connectButton().disabled).toBe(true)
    await expect.element(page.getByTestId('remote-host-hint')).toHaveTextContent('Use a host name, an ~/.ssh/config alias or user@host.')
    await userEvent.fill(page.getByTestId('remote-host'), 'work-box')
    expect(connectButton().disabled).toBe(false)
    expect(document.querySelector('[data-testid="remote-host-hint"]')).toBeNull()
  })

  describe('the host list', () => {
    const rows = (): Element[] => [...document.querySelectorAll('[data-testid="remote-host-row"]')]
    const HOSTS: RemoteHost[] = [
      { name: 'work-box', source: 'recent', status: 'ready' },
      { name: 'lab', source: 'ssh-config', status: 'off' },
      { name: 'gone', source: 'ssh-config', status: 'unreachable', detail: 'gone did not answer.' },
      { name: 'peer.tail1.ts.net', source: 'tailscale', status: 'unknown' },
      { name: 'locked.tail1.ts.net', source: 'tailscale', status: 'refused', detail: 'Tailscale reached locked.tail1.ts.net but…' },
    ]

    it('asks for a probe on opening, and shows each host with its status, tag and the failure as the title', async () => {
      const { fake } = await renderApp()
      fake.state.remoteHosts = HOSTS
      await openDialog(fake)
      await until(() => rows().length === 5)
      expect(fake.state.remoteHostProbes).toEqual([true])
      expect(rows().map((r) => [r.getAttribute('data-status'), r.textContent])).toEqual([
        ['ready', 'work-boxrecentready'], ['off', 'labssh configremote access off'], ['unreachable', 'gonessh configunreachable'],
        ['unknown', 'peer.tail1.ts.netTailscalechecking…'], ['refused', 'locked.tail1.ts.netTailscalelogin refused'],
      ])
      expect(rows()[2].getAttribute('title')).toBe('gone did not answer.')
      expect(rows()[3].querySelector('.btn-spinner')).not.toBeNull()
    })

    it('says each status in words beside the source tag, since a dot alone told nobody what grey meant', async () => {
      const { fake } = await renderApp()
      fake.state.remoteHosts = HOSTS
      await openDialog(fake)
      await until(() => rows().length === 5)
      expect(rows().map((r) => r.querySelector('[data-testid="remote-host-status"]')?.textContent)).toEqual([
        'ready', 'remote access off', 'unreachable', 'checking…', 'login refused',
      ])
    })

    it('updates as probe results arrive', async () => {
      const { fake } = await renderApp()
      fake.state.remoteHosts = HOSTS
      await openDialog(fake)
      await until(() => rows().length === 5)
      fake.emit('remoteHostsChanged', HOSTS.map((h) => (h.status === 'unknown' ? { ...h, status: 'ready' as const } : h)))
      await until(() => rows()[3].getAttribute('data-status') === 'ready')
      expect(rows()[3].querySelector('.btn-spinner')).toBeNull()
    })

    it('fills the field on a click and connects on a double-click', async () => {
      const { fake } = await renderApp()
      fake.state.remoteHosts = HOSTS
      await openDialog(fake)
      await until(() => rows().length === 5)
      await userEvent.click(rows()[1])
      expect(field().value).toBe('lab')
      expect(fake.state.remoteConnects).toEqual([])
      await userEvent.dblClick(rows()[0])
      await until(() => dialog() === null)
      expect(fake.state.remoteConnects).toEqual(['work-box'])
    })
  })

  describe('when Apiary is not running there', () => {
    const NOT_ACCEPTING = 'Apiary on work-box is not accepting remote connections. Turn on Settings → General → Allow remote access over SSH there, and keep Apiary open.'
    const offer = (): Element | null => document.querySelector('[data-testid="remote-offer"]')
    const row = (status: RemoteHost['status'], checkedAt: number): RemoteHost => ({ name: 'work-box', source: 'recent', status, checkedAt })

    it('offers to start it after an unreachable error whose fresh probe says stopped, and the button starts and connects', async () => {
      const { fake } = await renderApp()
      fake.state.remoteHosts = [row('ready', 1)]
      fake.state.remoteConnectError = NOT_ACCEPTING
      await openDialog(fake)
      await userEvent.fill(page.getByTestId('remote-host'), 'work-box')
      await userEvent.click(page.getByTestId('remote-connect'))
      await until(() => document.querySelector('[data-testid="remote-error"]') !== null)
      expect(offer()).toBeNull() // the probe has not answered yet
      fake.emit('remoteHostsChanged', [row('stopped', Date.now() + 1000)])
      await until(() => offer() !== null)
      expect(offer()?.textContent).toContain("Apiary isn't running on work-box.")
      // The offer replaces the "not accepting" error, and its button is the one primary action.
      expect(document.querySelector('[data-testid="remote-error"]')).toBeNull()
      expect(document.querySelector('[data-testid="remote-connect"]')?.classList.contains('primary')).toBe(false)
      await userEvent.click(page.getByTestId('remote-start'))
      await until(() => dialog() === null)
      expect(fake.state.remoteStarts).toEqual(['work-box'])
    })

    it('does not offer on the strength of an older probe, nor after another kind of error', async () => {
      const { fake } = await renderApp()
      fake.state.remoteHosts = [row('stopped', 1)]
      fake.state.remoteConnectError = NOT_ACCEPTING
      await openDialog(fake)
      await until(() => document.querySelectorAll('[data-testid="remote-host-row"]').length === 1)
      await userEvent.fill(page.getByTestId('remote-host'), 'other')
      await userEvent.click(page.getByTestId('remote-connect'))
      await until(() => document.querySelector('[data-testid="remote-error"]') !== null)
      fake.emit('remoteHostsChanged', [row('stopped', 1)])
      await stays(() => offer() === null, 200, 'no offer from a probe made before the failure')
    })

    it('marks a stopped row "not running", and a double-click on it offers the start instead of connecting', async () => {
      const { fake } = await renderApp()
      fake.state.remoteHosts = [row('stopped', 1)]
      await openDialog(fake)
      await until(() => document.querySelectorAll('[data-testid="remote-host-row"]').length === 1)
      expect(document.querySelector('[data-testid="remote-host-row"]')?.textContent).toContain('not running')
      await userEvent.dblClick(document.querySelector('[data-testid="remote-host-row"]') as Element)
      await until(() => offer() !== null)
      expect(fake.state.remoteConnects).toEqual([])
    })

    it('shows why when starting fails, and the offer stays', async () => {
      const { fake } = await renderApp()
      fake.state.remoteHosts = [row('stopped', 1)]
      fake.state.remoteStartError = 'Could not start Apiary on work-box. Start it there, or log in to its desktop first.'
      await openDialog(fake)
      await until(() => document.querySelectorAll('[data-testid="remote-host-row"]').length === 1)
      await userEvent.dblClick(document.querySelector('[data-testid="remote-host-row"]') as Element)
      await until(() => offer() !== null)
      await userEvent.click(page.getByTestId('remote-start'))
      await until(() => document.querySelector('[data-testid="remote-error"]') !== null)
      expect(document.querySelector('[data-testid="remote-error"]')?.textContent).toContain('log in to its desktop')
      expect(offer()).not.toBeNull()
    })
  })

  describe('the pairing code', () => {
    const pairingField = (): HTMLInputElement | null => document.querySelector<HTMLInputElement>('[data-testid="remote-pairing"]')
    const tryConnect = async (fake: FakeApiary, error: string): Promise<void> => {
      fake.state.remoteConnectError = error
      await userEvent.fill(page.getByTestId('remote-host'), 'work-box')
      await userEvent.click(page.getByTestId('remote-connect'))
      await until(() => pairingField() !== null)
    }

    it('appears when the work machine asks for it, and says where to find it', async () => {
      const { fake } = await renderApp()
      await openDialog(fake)
      expect(pairingField()).toBeNull()
      await tryConnect(fake, pairingErrorMessage('pairing-required', 'work-box'))
      expect(document.querySelector('[data-testid="remote-pairing-ask"]')?.textContent)
        .toBe('work-box asks for the pairing code shown in its Settings → General.')
      expect(document.querySelector('[data-testid="remote-error"]')).toBeNull()
      expect(document.querySelector('[data-testid="remote-pairing-unsaved"]')).toBeNull()
      expect(connectButton().disabled).toBe(true)
    })

    it('is sent with Connect, and only a well-formed code enables it', async () => {
      const { fake } = await renderApp()
      await openDialog(fake)
      await tryConnect(fake, pairingErrorMessage('pairing-required', 'work-box'))
      fake.state.remoteConnectError = null
      await userEvent.fill(page.getByTestId('remote-pairing'), 'kmnp-23')
      expect(connectButton().disabled).toBe(true)
      await userEvent.fill(page.getByTestId('remote-pairing'), 'KMNP-2345')
      expect(connectButton().disabled).toBe(false)
      await userEvent.click(page.getByTestId('remote-connect'))
      await until(() => dialog() === null)
      expect(fake.state.remoteConnects).toEqual(['work-box', 'work-box'])
      expect(fake.state.remoteConnectPairings).toEqual([undefined, 'KMNP-2345'])
    })

    it('says so when the code was wrong, and asks again with an empty field', async () => {
      const { fake } = await renderApp()
      await openDialog(fake)
      await tryConnect(fake, pairingErrorMessage('pairing-required', 'work-box'))
      await userEvent.fill(page.getByTestId('remote-pairing'), 'WXYZ-6789')
      fake.state.remoteConnectError = pairingErrorMessage('pairing-wrong', 'work-box')
      await userEvent.click(page.getByTestId('remote-connect'))
      await until(() => document.querySelector('[data-testid="remote-pairing-ask"]')?.textContent?.startsWith('That is not') === true)
      expect(pairingField()?.value).toBe('')
    })

    it('notes, muted, that the code cannot be kept when this computer cannot encrypt it', async () => {
      const { fake } = await renderApp()
      await openDialog(fake)
      await tryConnect(fake, pairingErrorMessage('pairing-required', 'work-box', false))
      expect(document.querySelector('[data-testid="remote-pairing-unsaved"]')?.textContent).toContain('enter it each time')
    })

    it('goes away when another host is chosen', async () => {
      const { fake } = await renderApp()
      await openDialog(fake)
      await tryConnect(fake, pairingErrorMessage('pairing-required', 'work-box'))
      await userEvent.fill(page.getByTestId('remote-host'), 'other-box')
      expect(pairingField()).toBeNull()
    })
  })

  it('closes on Escape', async () => {
    const { fake } = await renderApp()
    await openDialog(fake)
    await userEvent.keyboard('{Escape}')
    await until(() => dialog() === null)
    expect(dialog()).toBeNull()
  })
})

describe('a remote window', () => {
  it('shows the badge and names itself after the host', async () => {
    await renderRemote('work-box')
    await expect.element(page.getByTestId('remote-badge')).toHaveTextContent('work-box')
    expect(document.querySelector('[data-testid="remote-badge"]')?.getAttribute('title')).toBe('Connected to work-box over SSH')
    expect(document.title).toBe('work-box — Apiary')
  })

  it('has no badge in an ordinary window', async () => {
    history.replaceState(null, '', `${location.pathname}?chrome=custom`)
    await renderApp()
    await expect.element(page.getByTestId('title-bar')).toBeVisible()
    expect(document.querySelector('[data-testid="remote-badge"]')).toBeNull()
  })

  it('mounts no pets, where an ordinary window does', async () => {
    const ordinary = await renderApp()
    ordinary.fake.state.pets = { enabled: true, generating: false, pets: [fakePet('pip', { size: 64 })] }
    ordinary.fake.emit('petsChanged', ordinary.fake.state.pets)
    await until(() => document.querySelector('[data-testid="pet-layer"]') !== null)
    const remote = await renderRemote('work-box')
    remote.fake.state.pets = { enabled: true, generating: false, pets: [fakePet('pip', { size: 64 })] }
    remote.fake.emit('petsChanged', remote.fake.state.pets)
    await expect.element(page.getByTestId('remote-badge')).toBeVisible()
    await stays(() => document.querySelector('[data-testid="pet-layer"]') === null, 200, 'no pet layer in a remote window')
  })

  it('shows the disconnected banner on remoteStatus, and Reconnect asks for the host again', async () => {
    const { fake } = await renderRemote('work-box')
    expect(document.querySelector('[data-testid="remote-banner"]')).toBeNull()
    fake.emit('remoteStatus', { state: 'disconnected', host: 'work-box', message: 'The connection dropped.' })
    await until(() => document.querySelector('[data-testid="remote-banner"]')?.textContent?.includes('Disconnected from work-box.') === true)
    await expect.element(page.getByTestId('remote-banner-message')).toHaveTextContent('The connection dropped.')
    fake.state.remoteConnectError = 'Permission denied (publickey).'
    await userEvent.click(page.getByTestId('remote-reconnect'))
    await expect.element(page.getByTestId('remote-banner-message')).toHaveTextContent('Permission denied (publickey).')
    expect(fake.state.remoteConnects).toEqual(['work-box'])
  })

  it('shows the reconnecting banner, then fetches the tree and a terminal snapshot again once connected', async () => {
    const { fake } = await renderRemote('work-box')
    const toggle = [...document.querySelectorAll<HTMLElement>('[data-testid="project-toggle"]')]
      .find((t) => t.querySelector('.project-label')?.textContent === 'work-a')
    const button = toggle?.closest('[data-testid="project-group"]')?.querySelector<HTMLElement>('[data-testid="new-session-button"]')
    if (button === null || button === undefined) throw new Error('no new-session-button on work-a')
    await userEvent.click(button)
    await until(() => fake.callsTo('ptySnapshot').length > 0)
    await until(() => fake.callsTo('tree').length > 0)

    fake.emit('remoteStatus', { state: 'reconnecting', host: 'work-box', message: 'The connection dropped.', attempt: 2 })
    await until(() => document.querySelector('[data-testid="remote-banner"]')?.textContent?.includes('Reconnecting to work-box… (attempt 2)') === true)
    await expect.element(page.getByTestId('remote-close-window')).toBeVisible()
    expect(document.querySelector('[data-testid="remote-reconnect"]')).toBeNull()
    const trees = fake.callsTo('tree').length
    const snapshots = fake.callsTo('ptySnapshot').length
    await stays(() => fake.callsTo('tree').length === trees, 100, 'nothing is fetched while reconnecting')

    fake.emit('remoteStatus', { state: 'connected', host: 'work-box' })
    await until(() => fake.callsTo('tree').length > trees && fake.callsTo('ptySnapshot').length > snapshots)
    await until(() => document.querySelector('[data-testid="remote-banner"]') === null)
  })

  it('ignores remoteStatus in an ordinary window', async () => {
    const { fake } = await renderApp()
    fake.emit('remoteStatus', { state: 'disconnected', host: 'work-box' })
    await stays(() => document.querySelector('[data-testid="remote-banner"]') === null, 150, 'no banner outside a remote window')
  })
})
