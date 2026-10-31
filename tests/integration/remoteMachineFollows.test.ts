import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IPC } from '@shared/ipc/contract'
import { asSessionId } from '@shared/domain/ids'
import type { RemoteConnection as RemoteConnectionType } from '../../src/main/remote/remoteConnection'

/**
 * The maintainer's case: at home, a window onto the work machine shows the work machine's status bar
 * (its usage meter and residents) and opens Settings on the work machine's machine settings. A
 * resident there that opens a session shows it in that window.
 *
 * Two machines with different residents, bar items and settings. The work machine's handlers are
 * behind a real `RemoteServer`, reached over a real `RemoteConnection`; home's `RemoteWindows` routes
 * each call by the channel scopes, as the registrar does in the app.
 */
vi.mock('electron', () => ({
  ipcMain: { handle: () => {}, on: () => {}, removeHandler: () => {}, removeAllListeners: () => {} },
  BrowserWindow: { getAllWindows: () => [] },
}))

const { createDispatcher } = await import('../../src/main/ipc/registrar')
const { RemoteServer } = await import('../../src/main/remote/remoteServer')
const { RemoteConnection } = await import('../../src/main/remote/remoteConnection')
const { RemoteWindows } = await import('../../src/main/remote/remoteWindows')
const { VirtualContentsRegistry } = await import('../../src/main/remote/virtualContents')
const { sendOpenSession } = await import('../../src/main/app/residentsContainer')

const VERSION = '0.0.0-follows-test'
const HOME_REMOTE_WINDOW = 600
const HOME_LOCAL_WINDOW = 601

/** One machine's residents, bar and machine settings, as its handlers answer them. */
function machine(resident: string, usage: string) {
  const settings: Record<string, unknown> = { recentSectionHours: 24 }
  const residents = [{ id: 'regent', name: resident }]
  return {
    settings,
    residents,
    handlers: {
      residentsList: () => [...residents],
      residentsAdd: (_e: unknown, kind: string) => { residents.push({ id: kind, name: `${kind} on ${usage}` }) },
      statusBarItems: () => [{ pluginId: 'claude-usage', id: 'usage', text: usage }],
      machineSettingsGet: () => ({ ...settings }),
      machineSettingsSet: (_e: unknown, patch: Record<string, unknown>) => { Object.assign(settings, patch) },
    },
  }
}

let workHome: string
let server: InstanceType<typeof RemoteServer>
let registry: InstanceType<typeof VirtualContentsRegistry>
let connection: RemoteConnectionType
let windows: InstanceType<typeof RemoteWindows>
let work: ReturnType<typeof machine>
let home: ReturnType<typeof machine>
const remoteWindowHeard: unknown[][] = []

beforeEach(async () => {
  workHome = mkdtempSync(join(tmpdir(), 'apiary-follows-work-'))
  remoteWindowHeard.length = 0
  work = machine('Work Regent', '42%')
  home = machine('Home Regent', '7%')
  registry = new VirtualContentsRegistry()
  server = new RemoteServer({
    homeDir: workHome, host: 'work-box', appVersion: VERSION, registry, layouts: () => [],
    pairing: { required: () => false, code: () => '' }, turnOff: () => {},
  })
  server.attachDispatcher(createDispatcher(work.handlers as never, {}))
  await server.start()
  connection = await RemoteConnection.connect(server.socketPath, { appVersion: VERSION })
  const homeContents = { isDestroyed: () => false, send: (channel: string, ...args: unknown[]) => { remoteWindowHeard.push([channel, ...args]) } }
  windows = new RemoteWindows((id) => (id === HOME_REMOTE_WINDOW ? homeContents : null))
  windows.bind(HOME_REMOTE_WINDOW, connection, 1, 'work-box')
  await vi.waitFor(() => { if (registry.list().length === 0) throw new Error('the work machine has not opened the window yet') })
})

afterEach(async () => {
  windows.unbind(HOME_REMOTE_WINDOW)
  connection.close()
  await server.stop()
  rmSync(workHome, { recursive: true, force: true })
})

/** A call from a home window, routed as the registrar routes it: forwarded, or handled at home. */
type Key = 'residentsList' | 'residentsAdd' | 'statusBarItems' | 'machineSettingsGet' | 'machineSettingsSet'

async function call(window: number, key: Key, args: unknown[] = []): Promise<unknown> {
  const routed = windows.routeInvoke(window, key, args)
  if (routed !== undefined) return routed
  return createDispatcher(home.handlers as never, {}).invoke(key, { sender: { id: window } } as never, args)
}

describe('a remote window follows the work machine', () => {
  it('its status bar shows the work machine\'s usage and residents; a home window keeps home\'s', async () => {
    expect(await call(HOME_REMOTE_WINDOW, 'residentsList')).toEqual([{ id: 'regent', name: 'Work Regent' }])
    expect(await call(HOME_REMOTE_WINDOW, 'statusBarItems')).toEqual([expect.objectContaining({ text: '42%' })])
    expect(await call(HOME_LOCAL_WINDOW, 'residentsList')).toEqual([{ id: 'regent', name: 'Home Regent' }])
    expect(await call(HOME_LOCAL_WINDOW, 'statusBarItems')).toEqual([expect.objectContaining({ text: '7%' })])
  })

  it('its Settings reads and writes the work machine\'s machine settings, not home\'s', async () => {
    await call(HOME_REMOTE_WINDOW, 'machineSettingsSet', [{ recentSectionHours: 5 }])
    expect(work.settings.recentSectionHours).toBe(5)
    expect(home.settings.recentSectionHours).toBe(24)
    expect(await call(HOME_REMOTE_WINDOW, 'machineSettingsGet')).toEqual({ recentSectionHours: 5 })
  })

  it('adding a resident from a remote window adds it on the work machine, which never had one', async () => {
    work.residents.length = 0
    await call(HOME_REMOTE_WINDOW, 'residentsAdd', ['regent'])
    expect(work.residents.map((r) => r.id)).toEqual(['regent'])
    expect(home.residents.map((r) => r.id)).toEqual(['regent'])
    expect(await call(HOME_REMOTE_WINDOW, 'residentsList')).toEqual([{ id: 'regent', name: 'regent on 42%' }])
  })

  it('a session a work-machine resident opens reaches the remote window', async () => {
    const id = asSessionId('work-session')
    const workFront = { heard: [] as unknown[][], send(channel: string, ...args: unknown[]) { this.heard.push([channel, ...args]) } }
    sendOpenSession(registry.list(), workFront, id)
    await vi.waitFor(() => { expect(remoteWindowHeard).toContainEqual([IPC.openSessionRequested.channel, id]) })
    // The work machine's own window is not asked while a remote window shows the machine.
    expect(workFront.heard).toEqual([])
  })

  it('with no remote window open, the session goes to the work machine\'s own window', () => {
    const id = asSessionId('work-session')
    const workFront = { heard: [] as unknown[][], send(channel: string, ...args: unknown[]) { this.heard.push([channel, ...args]) } }
    sendOpenSession([], workFront, id)
    expect(workFront.heard).toEqual([[IPC.openSessionRequested.channel, id]])
  })
})
