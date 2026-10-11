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
const { RemoteServer } = await import('../../src/main/remote/remoteServer')
const { RemoteWindows } = await import('../../src/main/remote/remoteWindows')
const { createVsCodeBridge } = await import('../../src/main/remote/vscodeBridge')
const { VirtualContentsRegistry } = await import('../../src/main/remote/virtualContents')
const { scopeOf } = await import('../../src/main/remote/scopes')
const { registerBroadcastSkip, registerBroadcastTargets } = await import('../../src/main/windows/broadcast')

const VERSION = '0.0.0-remote-test'
const UNAVAILABLE = new Set((Object.keys(IPC) as IpcKey[]).filter((key) => scopeOf(key) === 'unavailable'))

defineBridgeContract('remote: a home window over the remote protocol', async (options) => {
  const registry = new VirtualContentsRegistry()
  const homeVsCode = { path: null as string | null, launched: [] as { command: string; args: string[] }[] }
  const bridge = createVsCodeBridge({
    vsCodePath: () => homeVsCode.path,
    spawn: (command, args) => { homeVsCode.launched.push({ command, args }); return {} as ChildProcess },
  })
  const windows = new RemoteWindows((id) => (id === fakeContents.id ? fakeContents : null), bridge)
  const world = await buildLoopbackWorld(options, { virtualContents: registry, router: windows })
  const workHome = mkdtempSync(join(tmpdir(), 'apiary-remote-contract-'))
  const server = new RemoteServer({ homeDir: workHome, host: 'work-box', appVersion: VERSION, registry, layouts: () => [], vscode: world.vscode })
  server.attachDispatcher(world.dispatcher)
  await server.start()
  const connection = await RemoteConnection.connect(server.socketPath, { appVersion: VERSION })
  const disposeTargets = registerBroadcastTargets(() => registry.list())
  const disposeSkip = registerBroadcastSkip(windows.skipsBroadcast)
  windows.bind(fakeContents.id, connection, 1, 'work-box')
  // The window is open on the work machine before the first call, as `open` is the first frame sent.
  return {
    ...world.bridge,
    remote: {
      unavailable: UNAVAILABLE,
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
