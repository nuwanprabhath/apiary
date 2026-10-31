import { vi } from 'vitest'
import type { ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IPC, type IpcKey } from '@shared/ipc/contract'
import { defineBridgeContract } from '../contract/bridgeContract'

/**
 * The whole bridge contract a third way: a home window showing a work machine. The work machine is
 * the loopback world of `contract.test.ts` (real services, real `registerIpc`), with a real
 * `RemoteServer` on a temp home in front of it. The window under test is the loopback's one fake
 * window, bound to a real `RemoteConnection` through the real `RemoteWindows` router, which the
 * registrar consults as in the app: `remote` calls cross the socket to a virtual window on the
 * work machine, `local` ones are handled by the handlers here, `unavailable` ones are answered by
 * the router, and the work machine's events come back over the connection.
 *
 * Both machines are one process, so `broadcast` reaches both windows; `registerBroadcastSkip`
 * keeps the bound window from hearing the work machine's events twice, as it does at home.
 *
 * A clause that needs an `unavailable` channel, or a window number on the work machine (the
 * remote window has none), skips itself (`skipOnRemote` in tests/contract/support.ts).
 */
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 })
vi.mock('electron', async () => (await import('./support/electronLoopback')).electronMock())

const { buildLoopbackWorld } = await import('./support/loopbackWorld')
const { fakeContents } = await import('./support/electronLoopback')
const { RemoteConnection } = await import('../../src/main/remote/remoteConnection')
const { createRemoteServing } = await import('../../src/main/app/remoteContainer')
const { RemoteWindows } = await import('../../src/main/remote/remoteWindows')
const { createVsCodeBridge } = await import('../../src/main/remote/vscodeBridge')
const { scopeOf } = await import('../../src/main/remote/scopes')
const { registerBroadcastSkip, registerBroadcastTargets } = await import('../../src/main/windows/broadcast')

const VERSION = '0.0.0-remote-test'
const UNAVAILABLE = new Set((Object.keys(IPC) as IpcKey[]).filter((key) => scopeOf(key) === 'unavailable'))

defineBridgeContract('remote: a home window over the remote protocol', async (options) => {
  const workHome = mkdtempSync(join(tmpdir(), 'apiary-remote-contract-'))
  // The app's own factory builds the work machine's server; its remote windows are the registry the world sees.
  const serving = createRemoteServing({
    homeDir: workHome, host: 'work-box', appVersion: VERSION, pairingFile: join(workHome, 'remote-pairing.json'), layouts: () => [],
    settings: { get: () => ({ remoteAccessPairing: false }), patch: () => {} },
  })
  const { remoteServer: server, virtualContents: registry } = serving
  const homeVsCode = { path: null as string | null, launched: [] as { command: string; args: string[] }[] }
  const bridge = createVsCodeBridge({
    vsCodePath: () => homeVsCode.path,
    spawn: (command, args) => { homeVsCode.launched.push({ command, args }); return {} as ChildProcess },
  })
  const windows = new RemoteWindows((id) => (id === fakeContents.id ? fakeContents : null), bridge)
  const world = await buildLoopbackWorld(options, { virtualContents: registry, router: windows })
  serving.useVsCode(world.vscode)
  const sent: { key: string; args: unknown[] }[] = []
  server.attachDispatcher({
    invoke: (key, event, raw) => world.dispatcher.invoke(key, event, raw),
    send: (key, event, raw) => { sent.push({ key, args: raw }); world.dispatcher.send(key, event, raw) },
  })
  await server.start()
  const connection = await RemoteConnection.connect(server.socketPath, { appVersion: VERSION })
  const disposeTargets = registerBroadcastTargets(() => registry.list())
  const disposeSkip = registerBroadcastSkip(windows.skipsBroadcast)
  windows.bind(fakeContents.id, connection, 1, 'work-box')
  // A forwarded call follows the `open` frame, but a call handled at home can broadcast an event
  // before the work machine has the window: wait for it, as a person cannot click that fast.
  await vi.waitFor(() => { if (registry.list().length === 0) throw new Error('the work machine has not opened the window yet') })
  return {
    ...world.bridge,
    remote: {
      unavailable: UNAVAILABLE,
      sentToWorkMachine: () => [...sent],
      homeVsCode: { setPath: (path) => { homeVsCode.path = path }, launched: homeVsCode.launched },
    },
    cleanup: async () => {
      disposeSkip()
      disposeTargets()
      windows.unbind(fakeContents.id)
      connection.close()
      await server.stop()
      await world.bridge.cleanup()
      rmSync(workHome, { recursive: true, force: true })
    },
  }
}, { remote: true })
