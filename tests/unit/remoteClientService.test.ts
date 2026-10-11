import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { pairingError, pairingErrorMessage, pairingNotSaved, type RemoteStatus } from '@shared/domain/remote'
import { errorMessage } from '@shared/errors'
import { RemoteClientService, type ClientConnection, type RemoteClientDeps } from '../../src/main/remote/remoteClientService'
import type { SshTunnel } from '../../src/main/remote/sshTunnel'
import type { DisconnectedListener } from '../../src/main/remote/remoteWindows'
import { UNREACHABLE_PREFIX } from '../../src/main/remote/remoteConnection'

vi.mock('electron', () => ({ ipcMain: { handle: () => {}, on: () => {} }, BrowserWindow: { getAllWindows: () => [] } }))

class FakeConnection {
  host = 'work-box'
  isClosed = false
  closedListeners: ((reason: string) => void)[] = []
  openWindow = vi.fn()
  closeWindow = vi.fn()
  invoke = vi.fn()
  resolve = vi.fn()
  send = vi.fn()
  onEvent = (): (() => void) => () => {}
  onClosed(l: (reason: string) => void): () => void { this.closedListeners.push(l); return () => {} }
  layouts = vi.fn(() => Promise.resolve([{ windowNumber: 3, layout: { n: 3 } }, { windowNumber: 2, layout: { n: 2 } }]))
  close = vi.fn(() => { this.isClosed = true })
}

function fakeTunnel(): SshTunnel & { ended(): void; stopFn: ReturnType<typeof vi.fn>; err: string } {
  let end!: () => void
  const exited = new Promise<void>((r) => { end = r })
  const stopFn = vi.fn(() => { end(); return Promise.resolve() })
  const t = {
    exited, err: '', ended: () => { end() },
    stderr: () => t.err,
    stop: stopFn, stopFn,
  }
  return t
}

function setup(over: Partial<RemoteClientDeps> = {}) {
  const log: string[] = []
  const tunnel = fakeTunnel()
  const connection = new FakeConnection()
  const statuses: [number, RemoteStatus][] = []
  let disconnected: DisconnectedListener = () => {}
  const win = new EventEmitter()
  const exec = vi.fn((_file: string, _args: string[], _cwd: string) => Promise.resolve('/home/me\n'))
  const connectFn = vi.fn((_path: string, _options: unknown) => Promise.resolve(connection as unknown as ClientConnection))
  let nextId = 7
  const focusWindow = vi.fn()
  const openWindow = vi.fn((_host: string, _layout?: unknown) => { log.push('opened'); return { webContentsId: nextId++, onClosed: (l: () => void) => { win.once('closed', l) } } })
  const startTunnel = vi.fn((_flags: string[], _host: string, _cwd: string) => tunnel)
  const removeDir = vi.fn(() => Promise.resolve())
  const unbind = vi.fn()
  const bind = vi.fn((_id: number, _connection: unknown, _w: number) => { log.push('bound') })
  const deps: RemoteClientDeps = {
    appVersion: '1.0.0', sshConfig: undefined, exec, startTunnel,
    connect: connectFn,
    makeTempDir: () => Promise.resolve('/tmp/apiary-x'),
    removeDir, socketExists: () => true,
    openWindow, focusWindow,
    windows: {
      bind, unbind,
      onDisconnected: (l) => { disconnected = l; return () => {} },
    },
    sendStatus: (id, status) => { statuses.push([id, status]) },
    probe: () => Promise.resolve('ready'), startPollMs: 5, startWaitMs: 200,
    ...over,
  }
  return { service: new RemoteClientService(deps), deps, focusWindow, connectFn, openWindow, bind, tunnel, connection, statuses, win, exec, startTunnel, removeDir, unbind, log, drop: (...a: Parameters<DisconnectedListener>) => { disconnected(...a) } }
}

describe('RemoteClientService', () => {
  it('asks for the home directory and forwards the socket with exactly the expected argv', async () => {
    const { service, exec, startTunnel } = setup()
    await service.connect('work-box')
    expect(exec).toHaveBeenCalledWith('ssh', ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', '--', 'work-box', 'printf', '%s', '$HOME'], expect.any(String))
    expect(startTunnel).toHaveBeenCalledWith(
      ['-N', '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3',
        '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10',
        '-L', '/tmp/apiary-x/s:/home/me/.apiary/remote.sock'],
      'work-box', '/tmp/apiary-x')
  })

  it('passes -F only when the test config is set', async () => {
    const { service, exec, startTunnel } = setup({ sshConfig: '/cfg' })
    await service.connect('work-box')
    expect(exec.mock.calls[0][1].slice(6, 8)).toEqual(['-F', '/cfg'])
    expect(startTunnel.mock.calls[0][0]).toContain('-F')
  })

  it.each([
    ['Host key verification failed.', "work-box's identity is not trusted yet, or it has changed. Run `ssh work-box` once in a terminal, check the fingerprint, and accept it. Then connect again."],
    ['me@work-box: Permission denied (publickey).', 'SSH refused the login to work-box. Apiary uses your SSH keys and agent; check that `ssh work-box` works without a password prompt.'],
    ['ssh: Could not resolve hostname work-box: nodename nor servname', 'No machine called work-box was found.'],
    ['\nssh: something odd\nmore', 'ssh: something odd'],
  ])('maps ssh stderr %j to a sentence', async (stderr, expected) => {
    const { service } = setup({ exec: vi.fn(() => Promise.reject(new Error(stderr))) })
    await expect(service.connect('work-box')).rejects.toThrow(expected)
  })

  it('maps a timed-out ssh to "did not answer"', async () => {
    const err = new Error('Command failed: ssh', { cause: { killed: true } })
    const { service } = setup({ exec: vi.fn(() => Promise.reject(err)) })
    await expect(service.connect('work-box')).rejects.toThrow('work-box did not answer.')
  })

  it('fails with the mapped stderr when the forwarding ssh exits before the socket appears, and cleans up', async () => {
    const { service, tunnel, removeDir } = setup({ socketExists: () => false, pollMs: 1 })
    tunnel.err = 'Permission denied (publickey).'
    tunnel.ended()
    await expect(service.connect('work-box')).rejects.toThrow('SSH refused the login to work-box')
    expect(removeDir).toHaveBeenCalledWith('/tmp/apiary-x')
  })

  it('says how to turn remote access on when the socket cannot be reached, and passes a refusal through', async () => {
    const unreachable = setup({ connect: vi.fn(() => Promise.reject(new Error(`${UNREACHABLE_PREFIX} work-box`))) })
    await expect(unreachable.service.connect('work-box')).rejects.toThrow('Apiary on work-box is not accepting remote connections. Turn on Settings → General → Allow remote access over SSH there, and keep Apiary open.')
    expect(unreachable.tunnel.stopFn).toHaveBeenCalled()
    const refused = setup({ connect: vi.fn(() => Promise.reject(new Error('This Apiary is 1.0.0 and work-box runs 2.0.0'))) })
    await expect(refused.service.connect('work-box')).rejects.toThrow('This Apiary is 1.0.0 and work-box runs 2.0.0')
  })

  it('two layouts give two windows, in number order, bound with w 1 and 2 before their pages can load', async () => {
    const { service, openWindow, bind, log, connection } = setup()
    connection.layouts.mockResolvedValue([{ windowNumber: 2, layout: { n: 2 } }, { windowNumber: 1, layout: { n: 1 } }])
    await service.connect('work-box')
    expect(log).toEqual(['opened', 'bound', 'opened', 'bound'])
    expect(openWindow.mock.calls.map((c) => c[1])).toEqual([{ n: 1 }, { n: 2 }])
    expect(bind.mock.calls.map((c) => [c[0], c[2]])).toEqual([[7, 1], [8, 2]])
  })

  it('opens one empty window with w 1 when the work machine has none', async () => {
    const { service, bind, openWindow, connection } = setup()
    connection.layouts.mockResolvedValue([])
    await service.connect('work-box')
    expect(openWindow).toHaveBeenCalledWith('work-box', undefined)
    // The window is bound with the host the user connected with, which VS Code's Remote-SSH reuses.
    expect(bind).toHaveBeenCalledWith(7, expect.anything(), 1, 'work-box')
  })

  it('a second connect to the same host focuses the first window and opens nothing', async () => {
    const { service, openWindow, focusWindow, connectFn } = setup()
    await service.connect('work-box')
    openWindow.mockClear()
    await service.connect('work-box')
    expect(focusWindow).toHaveBeenCalledWith(7)
    expect(openWindow).not.toHaveBeenCalled()
    expect(connectFn).toHaveBeenCalledTimes(1)
  })

  it('stops ssh and removes the directory when the last window closes', async () => {
    const { service, tunnel, removeDir, connection, win, unbind } = setup()
    await service.connect('work-box')
    win.emit('closed')
    await vi.waitFor(() => { expect(removeDir).toHaveBeenCalledWith('/tmp/apiary-x') })
    expect(unbind).toHaveBeenCalledWith(7)
    expect(connection.close).toHaveBeenCalled()
    expect(tunnel.stopFn).toHaveBeenCalled()
  })

  describe('startRemoteApp', () => {
    const START = "sh -c 'if [ \"$(uname -s)\" = Darwin ]; then open -g -a Apiary --args --background; else systemd-run --user --collect apiary --background; fi'"

    it('runs exactly the expected argv over ssh, with no prompt and a known host key', async () => {
      const { service, exec } = setup()
      await service.startRemoteApp('work-box')
      expect(exec.mock.calls[0][1]).toEqual(['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', '--', 'work-box', START])
    })

    it('then polls until the socket is there and connects', async () => {
      const answers = ['stopped', 'stopped', 'ready'] as const
      const probe = vi.fn(() => Promise.resolve(answers[Math.min(probe.mock.calls.length - 1, 2)]))
      const { service, openWindow } = setup({ probe })
      await service.startRemoteApp('work-box')
      expect(probe).toHaveBeenCalledTimes(3)
      expect(openWindow).toHaveBeenCalled()
    })

    it('says remote access is off when Apiary started but no socket appears', async () => {
      const { service, openWindow } = setup({ probe: () => Promise.resolve('off') })
      await expect(service.startRemoteApp('work-box')).rejects.toThrow(
        'Apiary started on work-box, but remote access is off there. Turn on Settings → General → Allow remote access over SSH on that machine.')
      expect(openWindow).not.toHaveBeenCalled()
    })

    it('says to start it there, or log in to its desktop, when it could not be started', async () => {
      const exec = vi.fn(() => Promise.reject(new Error('Failed to connect to bus')))
      const probe = vi.fn(() => Promise.resolve('ready' as const))
      const { service } = setup({ exec, probe })
      await expect(service.startRemoteApp('work-box')).rejects.toThrow('Could not start Apiary on work-box. Start it there, or log in to its desktop first.')
      expect(probe).not.toHaveBeenCalled()
    })
  })

  describe('when the connection drops', () => {
    const dropped = async (over: Partial<RemoteClientDeps> = {}) => {
      vi.useFakeTimers()
      const s = setup(over)
      s.connection.layouts.mockResolvedValue([{ windowNumber: 1, layout: { n: 1 } }, { windowNumber: 2, layout: { n: 2 } }])
      await s.service.connect('work-box')
      s.drop([7, 8], 'work-box', 'Disconnected from work-box')
      return s
    }
    afterEach(() => { vi.useRealTimers() })

    it('sends reconnecting and retries on the backoff schedule', async () => {
      const { statuses, connectFn, exec } = await dropped()
      exec.mockRejectedValue(new Error('Connection refused'))
      const attempts = (): number[] => statuses.filter(([id, s]) => id === 7 && s.state === 'reconnecting').map(([, s]) => s.attempt ?? 0)
      expect(statuses[0]).toEqual([7, { state: 'reconnecting', host: 'work-box', message: 'Disconnected from work-box', attempt: 1 }])
      for (const [ms, expected] of [[999, 1], [1, 2], [2000, 3], [5000, 4], [10_000, 5], [30_000, 6], [30_000, 7]] as const) {
        await vi.advanceTimersByTimeAsync(ms)
        expect(attempts().length).toBe(expected)
      }
      expect(connectFn).toHaveBeenCalledTimes(1)
      expect(exec).toHaveBeenCalledTimes(1 + 6)
    })

    it('rebinds every window with the same w, then sends connected', async () => {
      const second = new FakeConnection()
      const { statuses, bind, connectFn } = await dropped()
      connectFn.mockResolvedValue(second)
      await vi.advanceTimersByTimeAsync(1000)
      expect(bind.mock.calls.slice(-2).map((c) => [c[0], c[1] === second, c[2]])).toEqual([[7, true, 1], [8, true, 2]])
      expect(statuses.slice(-2)).toEqual([[7, { state: 'connected', host: 'work-box' }], [8, { state: 'connected', host: 'work-box' }]])
    })

    it('stops retrying with disconnected on a refusal that will not fix itself', async () => {
      const { statuses, connectFn } = await dropped()
      connectFn.mockRejectedValue(new Error('This Apiary is 1.0.0 and work-box runs 2.0.0'))
      await vi.advanceTimersByTimeAsync(1000)
      expect(statuses.at(-1)).toEqual([8, { state: 'disconnected', host: 'work-box', message: 'This Apiary is 1.0.0 and work-box runs 2.0.0' }])
      const calls = connectFn.mock.calls.length
      await vi.advanceTimersByTimeAsync(120_000)
      expect(connectFn.mock.calls.length).toBe(calls)
    })

    it('keeps retrying while the work machine\'s socket is unreachable (its Apiary restarting), then reconnects', async () => {
      const second = new FakeConnection()
      const { statuses, connectFn } = await dropped()
      connectFn.mockRejectedValueOnce(new Error(`${UNREACHABLE_PREFIX} work-box`))
      await vi.advanceTimersByTimeAsync(1000)
      expect(statuses.at(-1)?.[1].state).toBe('reconnecting')
      connectFn.mockResolvedValue(second)
      await vi.advanceTimersByTimeAsync(2000)
      expect(statuses.at(-1)).toEqual([8, { state: 'connected', host: 'work-box' }])
    })

    it('stops retrying when the last window closes during the backoff', async () => {
      const { win, connectFn, exec, removeDir } = await dropped()
      win.emit('closed')
      await vi.advanceTimersByTimeAsync(120_000)
      expect(connectFn).toHaveBeenCalledTimes(1)
      expect(exec).toHaveBeenCalledTimes(1)
      expect(removeDir).toHaveBeenCalled()
    })
  })

  it('tells windows with no session that their connection ended', async () => {
    const { statuses, drop } = setup()
    drop([3], 'other', 'gone')
    expect(statuses).toEqual([[3, { state: 'disconnected', host: 'other', message: 'gone' }]])
  })

  it('stops every ssh on quit', async () => {
    const a = setup()
    await a.service.connect('work-box')
    await a.service.dispose()
    expect(a.tunnel.stopFn).toHaveBeenCalled()
    expect(a.removeDir).toHaveBeenCalledWith('/tmp/apiary-x')
  })
})

describe('RemoteClientService: the pairing code', () => {
  const CODE = 'KMNP-2345'
  const memory = (initial: Record<string, string> = {}, canSave = true) => {
    const codes = new Map(Object.entries(initial))
    return {
      codes,
      get: vi.fn((host: string) => codes.get(host) ?? null),
      save: vi.fn((host: string, code: string) => { if (canSave) codes.set(host, code); return canSave }),
      forget: vi.fn((host: string) => { codes.delete(host) }),
      canSave,
    }
  }
  const sentWith = (connectFn: ReturnType<typeof setup>['connectFn']): unknown[] =>
    connectFn.mock.calls.map((c) => (c[1] as { pairing?: string }).pairing)

  afterEach(() => { vi.useRealTimers() })

  it('sends a saved code on a connect that was given none', async () => {
    const { service, connectFn } = setup({ pairingCodes: memory({ 'work-box': CODE }) })
    await service.connect('work-box')
    expect(sentWith(connectFn)).toEqual([CODE])
  })

  it('sends a typed code and saves it once it got in, but not when it was refused', async () => {
    const pairingCodes = memory()
    const { service, connectFn } = setup({ pairingCodes })
    connectFn.mockRejectedValueOnce(new Error(pairingErrorMessage('pairing-wrong', 'work-box')))
    await expect(service.connect('work-box', 'WXYZ-6789')).rejects.toThrow(/Pairing code wrong/)
    expect(pairingCodes.save).not.toHaveBeenCalled()
    await service.connect('work-box', CODE)
    expect(sentWith(connectFn)).toEqual(['WXYZ-6789', CODE])
    expect(pairingCodes.save).toHaveBeenCalledWith('work-box', CODE)
  })

  it('deletes a saved code the work machine no longer accepts, and the error asks for a new one', async () => {
    const pairingCodes = memory({ 'work-box': CODE })
    const { service, connectFn } = setup({ pairingCodes })
    connectFn.mockRejectedValue(new Error(pairingErrorMessage('pairing-wrong', 'work-box')))
    const error = await service.connect('work-box').catch((e: unknown) => e)
    expect(pairingError(errorMessage(error))).toBe('pairing-wrong')
    expect(pairingCodes.forget).toHaveBeenCalledWith('work-box')
    expect(pairingCodes.codes.has('work-box')).toBe(false)
  })

  it('does not delete a saved code because a code the user typed was wrong', async () => {
    const pairingCodes = memory({ 'work-box': CODE })
    const { service, connectFn } = setup({ pairingCodes })
    connectFn.mockRejectedValue(new Error(pairingErrorMessage('pairing-wrong', 'work-box')))
    await expect(service.connect('work-box', 'WXYZ-6789')).rejects.toThrow()
    expect(pairingCodes.forget).not.toHaveBeenCalled()
  })

  it('asks for the code when none is saved, and says when it cannot be remembered', async () => {
    const { service, connectFn } = setup({ pairingCodes: memory({}, false) })
    connectFn.mockRejectedValue(new Error(pairingErrorMessage('pairing-required', 'work-box')))
    const message = errorMessage(await service.connect('work-box').catch((e: unknown) => e))
    expect(pairingError(message)).toBe('pairing-required')
    expect(pairingNotSaved(message)).toBe(true)
  })

  it('sends the saved code again on a reconnect', async () => {
    vi.useFakeTimers()
    const { service, connectFn, drop } = setup({ pairingCodes: memory({ 'work-box': CODE }) })
    await service.connect('work-box')
    drop([7], 'work-box', 'Disconnected from work-box')
    await vi.advanceTimersByTimeAsync(1000)
    expect(sentWith(connectFn)).toEqual([CODE, CODE])
  })

  it('keeps a typed code for the reconnects of this session when it could not be saved, and saves nothing', async () => {
    vi.useFakeTimers()
    const pairingCodes = memory({}, false)
    const { service, connectFn, drop } = setup({ pairingCodes })
    await service.connect('work-box', CODE)
    drop([7], 'work-box', 'Disconnected from work-box')
    await vi.advanceTimersByTimeAsync(1000)
    expect(sentWith(connectFn)).toEqual([CODE, CODE])
    expect(pairingCodes.codes.size).toBe(0)
  })

  it('sends no code when none is saved and none was typed', async () => {
    const { service, connectFn } = setup({ pairingCodes: memory() })
    await service.connect('work-box')
    expect(sentWith(connectFn)).toEqual([undefined])
  })
})
