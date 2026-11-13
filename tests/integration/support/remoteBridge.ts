import type { ChildProcess } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vi } from 'vitest'
import { IPC, type IpcKey } from '@shared/ipc/contract'
import { CONTRACT_AREAS } from '../../contract/bridgeContract'
import type { Bridge, BridgeOptions } from '../../contract/support'
import { buildLoopbackWorld } from './loopbackWorld'
import { fakeContents } from './electronLoopback'
import { RemoteConnection } from '../../../src/main/remote/remoteConnection'
import { createRemoteServing } from '../../../src/main/app/remoteContainer'
import { RemoteWindows } from '../../../src/main/remote/remoteWindows'
import { shell } from 'electron'
import { createBridges } from '../../../src/main/remote/bridges'
import { scopeOf } from '../../../src/main/remote/scopes'
import { registerBroadcastSkip, registerBroadcastTargets } from '../../../src/main/windows/broadcast'

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
 *
 * Loaded after the test file mocks `electron` (`remoteContract.test.ts`, `remoteContract2.test.ts`).
 */
const VERSION = '0.0.0-remote-test'
const UNAVAILABLE = new Set((Object.keys(IPC) as IpcKey[]).filter((key) => scopeOf(key) === 'unavailable'))

export async function makeRemoteBridge(options: BridgeOptions): Promise<Bridge> {
  const workHome = mkdtempSync(join(tmpdir(), 'apiary-remote-contract-'))
  // The app's own factory builds the work machine's server; its remote windows are the registry the world sees.
  const serving = createRemoteServing({
    homeDir: workHome, host: 'work-box', appVersion: VERSION, pairingFile: join(workHome, 'remote-pairing.json'), layouts: () => [],
    settings: { get: () => ({ remoteAccessPairing: false }), patch: () => {} },
  })
  const { remoteServer: server, virtualContents: registry } = serving
  const homeVsCode = { path: null as string | null, launched: [] as { command: string; args: string[] }[] }
  // The app's own factory: the home machine's `shell` is the mocked electron's, which records what opened.
  const bridge = createBridges({
    vsCodePath: () => homeVsCode.path,
    spawn: (command, args) => { homeVsCode.launched.push({ command, args }); return {} as ChildProcess },
    openExternal: (url) => shell.openExternal(url),
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
}

const CLAUSES = join(import.meta.dirname, '..', '..', 'contract', 'clauses')

/**
 * The clause areas the remote run leaves out: every bridge call in the area's file is to a `local`
 * channel, which a remote window handles at home with the same handlers as `contract.test.ts`, and
 * the file never asks whether it runs remotely. Run here, such an area repeated the local run
 * clause for clause (measured: none of its calls reached the work machine). Read from the source,
 * so an area that starts calling a `remote` channel runs here again by itself.
 */
export const HOME_ONLY_AREAS: ReadonlySet<string> = new Set(CONTRACT_AREAS.filter((area) => {
  const src = readFileSync(join(CLAUSES, `${area}.ts`), 'utf8')
  const calls = [...src.matchAll(/\bapi\.(\w+)/g)].map((m) => m[1] ?? '').filter((key): key is IpcKey => key in IPC)
  return calls.length > 0 && calls.every((key) => scopeOf(key) === 'local') && !/bridge\.remote|skipOnRemote|\.remote\b/.test(src)
}))

const files = readdirSync(CLAUSES).filter((f) => f.endsWith('.ts')).map((f) => f.slice(0, -3)).sort()
const missing = files.filter((f) => !CONTRACT_AREAS.includes(f))
if (missing.length > 0) throw new Error(`clauses/${missing.join(', ')} not in bridgeContract.ts's AREAS: they would never run`)
