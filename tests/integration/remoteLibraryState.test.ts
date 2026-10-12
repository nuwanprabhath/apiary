import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChildProcess } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IPC } from '@shared/ipc/contract'
import type { LibrarySnapshot } from '@shared/libraryState'
import type { RemoteConnection as RemoteConnectionType } from '../../src/main/remote/remoteConnection'

/**
 * The maintainer's case: at home, a remote window onto the work machine must show the work
 * machine's groups, pins and "hide tool calls", not home's, and a change made in it must land in the
 * work machine's file and reach the work machine's own windows.
 *
 * Two machines, two `LibraryStateService`s on their own files. The work machine's is behind a real
 * `RemoteServer`; home reaches it over a real `RemoteConnection`, and home's `RemoteWindows` routes
 * a bound window's calls by the channel scopes, as the registrar does in the app.
 */

/** The work machine's one local window, as Electron would list it. */
const workWindow = { heard: [] as LibrarySnapshot[] }
vi.mock('electron', () => ({
  ipcMain: { handle: () => {}, on: () => {}, removeHandler: () => {}, removeAllListeners: () => {} },
  BrowserWindow: {
    getAllWindows: () => [{
      isDestroyed: () => false,
      webContents: {
        id: 77,
        send: (channel: string, snapshot: LibrarySnapshot) => { if (channel === IPC.libraryStateChanged.channel) workWindow.heard.push(snapshot) },
      },
    }],
  },
}))

const { LibraryStateService } = await import('../../src/main/library/libraryStateService')
const { libraryStateHandlers } = await import('../../src/main/ipc/handlers/libraryState')
const { createDispatcher } = await import('../../src/main/ipc/registrar')
const { RemoteServer } = await import('../../src/main/remote/remoteServer')
const { RemoteConnection } = await import('../../src/main/remote/remoteConnection')
const { RemoteWindows } = await import('../../src/main/remote/remoteWindows')
const { VirtualContentsRegistry } = await import('../../src/main/remote/virtualContents')
const { createVsCodeBridge } = await import('../../src/main/remote/vscodeBridge')
const { broadcast, registerBroadcastTargets } = await import('../../src/main/windows/broadcast')

const VERSION = '0.0.0-library-test'
const HOME_REMOTE_WINDOW = 500
const HOME_LOCAL_WINDOW = 501

let workHome: string
let homeHome: string
let server: InstanceType<typeof RemoteServer>
let connection: RemoteConnectionType
let windows: InstanceType<typeof RemoteWindows>
let disposeTargets: () => void
let homeLibrary: InstanceType<typeof LibraryStateService>
const remoteWindowHeard: unknown[][] = []

beforeEach(async () => {
  workHome = mkdtempSync(join(tmpdir(), 'apiary-library-work-'))
  homeHome = mkdtempSync(join(tmpdir(), 'apiary-library-home-'))
  workWindow.heard.length = 0
  remoteWindowHeard.length = 0

  const workLibrary = new LibraryStateService({
    file: join(workHome, 'library-state.json'), moved: {}, onChanged: (s) => { broadcast(IPC.libraryStateChanged, s) },
  })
  workLibrary.set({
    groups: [{ id: 'work', name: 'Work' }], groupAssignments: { '/repo/a': 'work' }, pinned: ['work-session'], hideToolCallIo: true,
  })
  workWindow.heard.length = 0
  homeLibrary = new LibraryStateService({ file: join(homeHome, 'library-state.json'), moved: {}, onChanged: () => {} })
  homeLibrary.set({ groups: [{ id: 'home', name: 'Home' }], pinned: ['home-session'] })

  const registry = new VirtualContentsRegistry()
  server = new RemoteServer({
    homeDir: workHome, host: 'work-box', appVersion: VERSION, registry, layouts: () => [],
    pairing: { required: () => false, code: () => '' }, turnOff: () => {},
  })
  server.attachDispatcher(createDispatcher(libraryStateHandlers(workLibrary), {}))
  disposeTargets = registerBroadcastTargets(() => registry.list())
  await server.start()

  connection = await RemoteConnection.connect(server.socketPath, { appVersion: VERSION })
  const homeContents = { isDestroyed: () => false, send:(channel: string, ...args: unknown[]) => { remoteWindowHeard.push([channel, ...args]) } }
  const bridge = createVsCodeBridge({ vsCodePath: () => null, spawn: () => ({}) as ChildProcess })
  windows = new RemoteWindows((id) => (id === HOME_REMOTE_WINDOW ? homeContents : null), bridge)
  windows.bind(HOME_REMOTE_WINDOW, connection, 1, 'work-box')
})

afterEach(async () => {
  windows.unbind(HOME_REMOTE_WINDOW)
  connection.close()
  disposeTargets()
  await server.stop()
  rmSync(workHome, { recursive: true, force: true })
  rmSync(homeHome, { recursive: true, force: true })
})

/** A call from a home window, routed as the registrar routes it: forwarded, or handled at home. */
async function call(window: number, key: 'libraryState' | 'setLibraryState', args: unknown[]): Promise<LibrarySnapshot> {
  const routed = windows.routeInvoke(window, key, args)
  if (routed !== undefined) return (await routed) as LibrarySnapshot
  const home = createDispatcher(libraryStateHandlers(homeLibrary), {})
  return (await home.invoke(key, { sender: { id: window } } as never, args)) as LibrarySnapshot
}

describe('library state in a remote window', () => {
  it('answers the work machine\'s groups, pins and tool-call default, not home\'s', async () => {
    const { state } = await call(HOME_REMOTE_WINDOW, 'libraryState', [])
    expect(state.groups).toEqual([{ id: 'work', name: 'Work' }])
    expect(state.groupAssignments).toEqual({ '/repo/a': 'work' })
    expect(state.pinned).toEqual(['work-session'])
    expect(state.hideToolCallIo).toBe(true)
    // A home window of its own still shows home's.
    expect((await call(HOME_LOCAL_WINDOW, 'libraryState', [])).state.groups).toEqual([{ id: 'home', name: 'Home' }])
  })

  it('a change made in the remote window lands in the work machine\'s file and reaches its windows', async () => {
    await call(HOME_REMOTE_WINDOW, 'setLibraryState', [{ pinned: ['from-home', 'work-session'], hideToolCallIo: false }])

    const onDisk = JSON.parse(readFileSync(join(workHome, 'library-state.json'), 'utf8')) as LibrarySnapshot['state']
    expect(onDisk.pinned).toEqual(['from-home', 'work-session'])
    expect(onDisk.hideToolCallIo).toBe(false)
    expect(workWindow.heard.at(-1)?.state.pinned).toEqual(['from-home', 'work-session'])
    // The remote window hears it too, over the connection.
    await vi.waitFor(() => {
      expect(remoteWindowHeard.some(([channel]) => channel === IPC.libraryStateChanged.channel)).toBe(true)
    })
    // Home's own library is untouched.
    expect(homeLibrary.snapshot().state.pinned).toEqual(['home-session'])
  })
})
