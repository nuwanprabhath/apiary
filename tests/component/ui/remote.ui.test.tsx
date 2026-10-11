import { afterEach, describe, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from '../renderApp'
import { until } from '../helpers'
import type { FakeApiary } from '../fakeApiary'
import { pairingErrorMessage } from '@shared/domain/remote'
import { reviewUi } from './review'

const dialogOpen = (): boolean => document.querySelector('[data-testid="remote-dialog"]') !== null

async function openDialog(fake: FakeApiary): Promise<void> {
  fake.emit('openRemoteDialog')
  await until(dialogOpen)
}

/** Mounts as main opens a remote window: a custom title bar and `remote=<host>` in the URL. */
async function renderRemote(host: string): ReturnType<typeof renderApp> {
  history.replaceState(null, '', `${location.pathname}?chrome=custom&remote=${host}`)
  return renderApp()
}

afterEach(() => { history.replaceState(null, '', location.pathname) })

const LONG_SSH_ERROR = [
  'ssh: connect to host work-box.corp.example.com port 22: Operation timed out',
  'kex_exchange_identification: Connection closed by remote host',
  'Apiary could not reach that machine. Check that it is on, that Settings → General → Allow remote access over SSH',
  'is on there, and that ~/.ssh/config names the right user and key for work-box.corp.example.com.',
].join('\n')

describe('UI: the connect dialog', () => {
  const askForCode = async (fake: FakeApiary, unsaved: boolean): Promise<void> => {
    await openDialog(fake)
    fake.state.remoteConnectError = pairingErrorMessage('pairing-required', 'work-box', !unsaved)
    await userEvent.fill(page.getByTestId('remote-host'), 'work-box')
    await userEvent.click(page.getByTestId('remote-connect'))
    await until(() => document.querySelector('[data-testid="remote-pairing"]') !== null)
  }

  it('connect dialog asking for the pairing code', async () => {
    const { fake } = await renderApp()
    await reviewUi('connect dialog pairing code', {
      widths: [620, 900],
      open: () => askForCode(fake, false),
      close: async () => { await userEvent.keyboard('{Escape}') },
    })
  })

  it('connect dialog asking for the pairing code it cannot keep', async () => {
    const { fake } = await renderApp()
    await reviewUi('connect dialog pairing code unsaved', {
      widths: [620, 900],
      open: () => askForCode(fake, true),
      close: async () => { await userEvent.keyboard('{Escape}') },
    })
  })

  it('connect dialog empty', async () => {
    const { fake } = await renderApp()
    await reviewUi('connect dialog empty', {
      widths: [620, 900, 1400],
      open: () => openDialog(fake),
      close: async () => { await userEvent.keyboard('{Escape}') },
    })
  })

  it('connect dialog with hosts', async () => {
    const { fake } = await renderApp()
    fake.state.remoteHosts = [
      { name: 'work-box', source: 'recent', status: 'ready' },
      { name: 'build-server.corp.example.com', source: 'recent', status: 'off' },
      { name: 'old-laptop', source: 'ssh-config', status: 'unreachable', detail: 'old-laptop did not answer.' },
      { name: 'peer.tail1234.ts.net', source: 'tailscale', status: 'unknown' },
    ]
    await reviewUi('connect dialog with hosts', {
      widths: [620, 900, 1400],
      open: async () => {
        await openDialog(fake)
        await userEvent.fill(page.getByTestId('remote-host'), 'dev@10.0.0.4')
      },
      close: async () => { await userEvent.keyboard('{Escape}') },
    })
  })

  it('connect dialog with a long host list', async () => {
    const { fake } = await renderApp()
    const statuses = ['ready', 'off', 'refused', 'unreachable', 'stopped', 'unknown'] as const
    fake.state.remoteHosts = Array.from({ length: 20 }, (_, i) => ({
      name: `host-${String(i)}.department.example.com`,
      source: (['recent', 'ssh-config', 'tailscale'] as const)[i % 3],
      status: statuses[i % statuses.length],
    }))
    await reviewUi('connect dialog long host list', {
      widths: [620, 900],
      open: async () => {
        await openDialog(fake)
        await until(() => document.querySelectorAll('[data-testid="remote-host-row"]').length === 20)
      },
      close: async () => { await userEvent.keyboard('{Escape}') },
    })
  })

  it('connect dialog with an invalid host', async () => {
    const { fake } = await renderApp()
    await reviewUi('connect dialog invalid host', {
      widths: [620, 900],
      open: async () => {
        await openDialog(fake)
        await userEvent.fill(page.getByTestId('remote-host'), '-oProxyCommand=x')
      },
      close: async () => { await userEvent.keyboard('{Escape}') },
    })
  })

  it('connect dialog connecting', async () => {
    const { fake } = await renderApp()
    fake.override('remoteConnect', () => new Promise<void>(() => undefined))
    await reviewUi('connect dialog connecting', {
      widths: [620, 900, 1400],
      open: async () => {
        await openDialog(fake)
        await userEvent.fill(page.getByTestId('remote-host'), 'work-box')
        await userEvent.click(page.getByTestId('remote-connect'))
        await until(() => document.querySelector('.btn-spinner') !== null)
      },
      // The held connection never settles, so the dialog is not closable by Escape's route to
      // Cancel (disabled); the next pass remounts the app instead.
      close: async () => { await userEvent.keyboard('{Escape}') },
    })
  })

  it('connect dialog error', async () => {
    const { fake } = await renderApp()
    fake.state.remoteConnectError = LONG_SSH_ERROR
    await reviewUi('connect dialog error', {
      widths: [620, 900, 1400],
      open: async () => {
        await openDialog(fake)
        await userEvent.fill(page.getByTestId('remote-host'), 'work-box.corp.example.com')
        await userEvent.click(page.getByTestId('remote-connect'))
        await until(() => document.querySelector('[data-testid="remote-error"]') !== null)
      },
      close: async () => { await userEvent.keyboard('{Escape}') },
    })
  })

  it('connect dialog offers to start Apiary', async () => {
    const { fake } = await renderApp()
    const host = 'build-server-with-a-long-name.corp.example.com'
    fake.state.remoteHosts = [
      { name: host, source: 'recent', status: 'ready' },
      { name: 'old-laptop', source: 'ssh-config', status: 'stopped', checkedAt: 1 },
    ]
    fake.state.remoteConnectError = `Apiary on ${host} is not accepting remote connections. Turn on Settings → General → Allow remote access over SSH there, and keep Apiary open.`
    await reviewUi('connect dialog offers to start Apiary', {
      widths: [620, 900, 1400],
      open: async () => {
        await openDialog(fake)
        await userEvent.fill(page.getByTestId('remote-host'), host)
        await userEvent.click(page.getByTestId('remote-connect'))
        await until(() => document.querySelector('[data-testid="remote-error"]') !== null)
        fake.emit('remoteHostsChanged', [
          { name: host, source: 'recent', status: 'stopped', checkedAt: Date.now() + 60_000 },
          { name: 'old-laptop', source: 'ssh-config', status: 'stopped', checkedAt: 1 },
        ])
        await until(() => document.querySelector('[data-testid="remote-offer"]') !== null)
      },
      close: async () => { await userEvent.keyboard('{Escape}') },
    })
  })

  it('starting Apiary', async () => {
    const { fake } = await renderApp()
    fake.state.remoteHosts = [{ name: 'work-box', source: 'recent', status: 'stopped', checkedAt: 1 }]
    fake.override('remoteStartAndConnect', () => new Promise<void>(() => undefined))
    await reviewUi('starting Apiary', {
      widths: [620, 900, 1400],
      open: async () => {
        await openDialog(fake)
        await until(() => document.querySelector('[data-testid="remote-host-row"]') !== null)
        await userEvent.dblClick(page.getByTestId('remote-host-row'))
        await userEvent.click(page.getByTestId('remote-start'))
        await until(() => document.querySelector('[data-testid="remote-offer-starting"]') !== null)
      },
      close: async () => { await userEvent.keyboard('{Escape}') },
    })
  })
})

describe('UI: a remote window', () => {
  it('remote window badge', async () => {
    await renderRemote('work-box')
    await reviewUi('remote window badge', {
      open: async () => { await until(() => document.querySelector('[data-testid="remote-badge"]') !== null) },
    })
  })

  it('remote window badge long host', async () => {
    await renderRemote('build-server-with-a-very-long-name.corp.example.com')
    await reviewUi('remote window badge long host', {
      widths: [620, 900],
      open: async () => { await until(() => document.querySelector('[data-testid="remote-badge"]') !== null) },
    })
  })

  it('remote window disconnected', async () => {
    const { fake } = await renderRemote('work-box')
    await reviewUi('remote window disconnected', {
      widths: [620, 900, 1400],
      open: async () => {
        fake.emit('remoteStatus', {
          state: 'disconnected', host: 'work-box', message: 'The SSH connection to work-box closed (exit code 255).',
        })
        await until(() => document.querySelector('[data-testid="remote-banner"]') !== null)
      },
    })
  })

  it('remote window reconnecting', async () => {
    const { fake } = await renderRemote('work-box')
    await reviewUi('remote window reconnecting', {
      widths: [620, 900, 1400],
      open: async () => {
        fake.emit('remoteStatus', {
          state: 'reconnecting', host: 'work-box', message: 'The SSH connection to work-box was lost.', attempt: 3,
        })
        await until(() => document.querySelector('[data-testid="remote-banner"]')?.textContent?.includes('attempt 3') === true)
      },
    })
  })

  it('remote window disconnected reconnect failed', async () => {
    const { fake } = await renderRemote('work-box')
    fake.state.remoteConnectError = LONG_SSH_ERROR
    await reviewUi('remote window reconnect failed', {
      widths: [620, 900],
      open: async () => {
        fake.emit('remoteStatus', { state: 'disconnected', host: 'work-box', message: 'The connection dropped.' })
        await until(() => document.querySelector('[data-testid="remote-reconnect"]') !== null)
        await userEvent.click(page.getByTestId('remote-reconnect'))
        await until(() => document.querySelector('[data-testid="remote-banner-message"]')?.textContent?.includes('Operation timed out') === true)
      },
    })
  })
})
