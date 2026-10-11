import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import type { RemoteStatus } from '@shared/domain/remote'
import { RemoteClientService } from '../../src/main/remote/remoteClientService'
import { RemoteConnection } from '../../src/main/remote/remoteConnection'
import { RemoteServer } from '../../src/main/remote/remoteServer'
import { RemoteWindows } from '../../src/main/remote/remoteWindows'
import { VirtualContentsRegistry } from '../../src/main/remote/virtualContents'
import { createDispatcher } from '../../src/main/ipc/registrar'
import { makePrivateDir, pathExists, removePrivateDir } from '../../src/main/remote/privateDir'

vi.mock('electron', () => ({
  ipcMain: { handle: () => {}, on: () => {}, removeHandler: () => {}, removeAllListeners: () => {} },
  BrowserWindow: { getAllWindows: () => [] },
}))

const VERSION = '1.36.0'
interface Sender { send(channel: string, ...args: unknown[]): void }

describe('RemoteClientService against a real RemoteServer', () => {
  let home: string
  let server: RemoteServer
  let win: EventEmitter
  let statuses: RemoteStatus[]
  let service: RemoteClientService
  let bound: number[]
  let windows: RemoteWindows
  let heard: unknown[][]
  let attached: { id: string; sender: Sender }[]

  function build(appVersion = VERSION): RemoteClientService {
    return new RemoteClientService({
      appVersion, sshConfig: undefined,
      exec: () => Promise.resolve(`${home}\n`),
      // "ssh": the forwarded socket is a symlink to the server's own.
      startTunnel: (flags, _host, cwd) => {
        const local = flags[flags.indexOf('-L') + 1].split(':')[0]
        symlinkSync(server.socketPath, join(cwd, local.split('/').pop() ?? 's'))
        return { exited: new Promise<void>(() => {}), stderr: () => '', stop: () => Promise.resolve() }
      },
      connect: (path, options) => RemoteConnection.connect(path, options),
      makeTempDir: makePrivateDir, removeDir: removePrivateDir, socketExists: pathExists,
      focusWindow: () => {},
      probe: () => Promise.resolve('ready'),
      openWindow: () => ({ webContentsId: 42, onClosed: (l) => { win.once('closed', l) } }),
      windows: {
        bind: (id, connection, w) => { bound.push(id); windows.bind(id, connection, w) },
        unbind: (id) => { windows.unbind(id) },
        onDisconnected: (l) => windows.onDisconnected(l),
      },
      sendStatus: (_id, status) => { statuses.push(status) },
    })
  }

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'apiary-rc-'))
    win = new EventEmitter()
    statuses = []
    bound = []
    heard = []
    attached = []
    windows = new RemoteWindows(() => ({ isDestroyed: () => false, send: (channel: string, ...args: unknown[]) => { heard.push([channel, ...args]) } }))
    server = new RemoteServer({
      homeDir: home, host: 'work-box', appVersion: VERSION, registry: new VirtualContentsRegistry(), layouts: () => [],
    })
    server.attachDispatcher(createDispatcher({}, { ptyAttach: (event, id) => { attached.push({ id, sender: (event as { sender: Sender }).sender }) } }))
    await server.start()
    service = build()
  })
  afterEach(async () => {
    await service.dispose()
    await server.stop()
    rmSync(home, { recursive: true, force: true })
  })

  it('connect opens a window bound to a live connection', async () => {
    await service.connect('work-box')
    expect(bound).toEqual([42])
  })

  it('a server stop tells the window it is reconnecting', async () => {
    await service.connect('work-box')
    await server.stop()
    await vi.waitFor(() => { expect(statuses[0]).toEqual({ state: 'reconnecting', host: 'work-box', message: 'Disconnected from work-box', attempt: 1 }) })
  })

  it('reconnects after the server restarts on the same socket, and a pty attached before delivers data again', async () => {
    await service.connect('work-box')
    expect(windows.routeSend(42, 'ptyAttach', ['pty-1'])).toBe(true)
    await vi.waitFor(() => { expect(attached).toHaveLength(1) })
    await server.stop()
    await vi.waitFor(() => { expect(statuses.map((s) => s.state)).toEqual(['reconnecting']) })
    await server.start()
    await vi.waitFor(() => { expect(statuses.map((s) => s.state)).toEqual(['reconnecting', 'connected']) }, { timeout: 8000 })
    await vi.waitFor(() => { expect(attached).toHaveLength(2) })
    attached[1].sender.send('apiary:pty-data', 'pty-1', 'hello again')
    await vi.waitFor(() => { expect(heard).toEqual([['apiary:pty-data', 'pty-1', 'hello again']]) })
  })

  it('a version mismatch rejects with the server\'s message', async () => {
    await expect(build('0.0.1').connect('work-box')).rejects.toThrow(`work-box runs Apiary ${VERSION}; this machine runs 0.0.1`)
  })
})
