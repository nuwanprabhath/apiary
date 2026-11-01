import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { InstallOutcome } from '@shared/domain/update'
import type { RemoteConnection as RemoteConnectionType } from '../../src/main/remote/remoteConnection'
import type { UpdateBackend, UpdateService as UpdateServiceType } from '../../src/main/update/updateService'

/**
 * In a remote window, the update banner is the work machine's: its status, and its Install and
 * restart, with the password, reach the work machine's updater and never home's. The work machine's
 * real update handlers are behind a real `RemoteServer`, reached over a real `RemoteConnection`;
 * home's `RemoteWindows` routes each call by the channel scopes, as the registrar does.
 */
vi.mock('electron', () => ({
  app: { getVersion: () => '0.0.0-test' },
  ipcMain: { handle: () => {}, on: () => {}, removeHandler: () => {}, removeAllListeners: () => {} },
  BrowserWindow: { getAllWindows: () => [] },
}))

const { createDispatcher } = await import('../../src/main/ipc/registrar')
const { RemoteServer } = await import('../../src/main/remote/remoteServer')
const { RemoteConnection } = await import('../../src/main/remote/remoteConnection')
const { RemoteWindows } = await import('../../src/main/remote/remoteWindows')
const { VirtualContentsRegistry } = await import('../../src/main/remote/virtualContents')
const { UpdateService } = await import('../../src/main/update/updateService')
const { updateHandlers } = await import('../../src/main/ipc/handlers/update')

const VERSION = '0.0.0-remote-update-test'
const HOME_REMOTE_WINDOW = 700
const HOME_LOCAL_WINDOW = 701

/** One machine's updater, offering `offered`, whose sudo wants `password`. */
function machine(current: string, offered: string, password: string) {
  const passwords: (string | null)[] = []
  const restarts: number[] = []
  const backend: UpdateBackend = {
    check: async () => ({ version: offered, releaseNotes: null, releaseUrl: null }),
    downloadForInstall: async () => {},
    install: () => {},
    downloadInstaller: async () => `/tmp/apiary_${offered}_amd64.deb`,
    openInstaller: async () => ({ ok: 'opened' }),
    needsPassword: async () => true,
    stillVerified: async () => true,
    installDownloaded: async (_path, o): Promise<InstallOutcome> => {
      passwords.push(o.password)
      return o.password === password ? { ok: true } : { ok: false, reason: 'password', message: 'That password was not accepted.' }
    },
    restart: () => { restarts.push(Date.now()) },
    takePreviousInstall: async () => null,
  }
  const service: UpdateServiceType = new UpdateService({
    currentVersion: current,
    capabilityInput: { platform: 'linux', packaged: true, appImagePath: undefined, macSigned: false },
    backend,
    settings: () => ({ automaticChecks: false, checkIntervalHours: 6, autoDownload: false, allowPrerelease: false, skippedVersion: null }),
    saveSettings: () => {},
    onStatus: () => {},
  })
  return { service, passwords, restarts, handlers: updateHandlers({ settings: null as never, updater: service }) }
}

let workHome: string
let server: InstanceType<typeof RemoteServer>
let connection: RemoteConnectionType
let windows: InstanceType<typeof RemoteWindows>
let work: ReturnType<typeof machine>
let home: ReturnType<typeof machine>

beforeEach(async () => {
  workHome = mkdtempSync(join(tmpdir(), 'apiary-update-work-'))
  work = machine('1.50.0', '1.51.0', 'work-secret')
  home = machine('1.49.0', '1.51.0', 'home-secret')
  const registry = new VirtualContentsRegistry()
  server = new RemoteServer({
    homeDir: workHome, host: 'work-box', appVersion: VERSION, registry, layouts: () => [],
    pairing: { required: () => false, code: () => '' }, turnOff: () => {},
  })
  server.attachDispatcher(createDispatcher(work.handlers, {}))
  await server.start()
  connection = await RemoteConnection.connect(server.socketPath, { appVersion: VERSION })
  windows = new RemoteWindows(() => null)
  windows.bind(HOME_REMOTE_WINDOW, connection, 1, 'work-box')
  await vi.waitFor(() => { if (registry.list().length === 0) throw new Error('the work machine has not opened the window yet') })
})

afterEach(async () => {
  windows.unbind(HOME_REMOTE_WINDOW)
  connection.close()
  await server.stop()
  rmSync(workHome, { recursive: true, force: true })
})

async function call(window: number, key: string, args: unknown[] = []): Promise<unknown> {
  const routed = windows.routeInvoke(window, key as never, args)
  if (routed !== undefined) return routed
  return createDispatcher(home.handlers, {}).invoke(key as never, { sender: { id: window } } as never, args)
}

describe('a remote window updates the work machine', () => {
  it('its update status is the work machine\'s; a home window keeps home\'s', async () => {
    await call(HOME_REMOTE_WINDOW, 'updateCheck')
    expect(await call(HOME_REMOTE_WINDOW, 'updateStatus')).toMatchObject({ currentVersion: '1.50.0', phase: 'available' })
    expect(await call(HOME_LOCAL_WINDOW, 'updateStatus')).toMatchObject({ currentVersion: '1.49.0', phase: 'idle' })
  })

  it('Install and restart, with the password, reaches the work machine\'s updater, and home\'s is never called', async () => {
    await call(HOME_REMOTE_WINDOW, 'updateCheck')
    expect(await call(HOME_REMOTE_WINDOW, 'updatePrepareInstall')).toEqual({ needsPassword: true })
    expect(await call(HOME_REMOTE_WINDOW, 'updateInstallAndRestart', [{ password: 'wrong' }])).toMatchObject({ ok: false, reason: 'password' })
    expect(await call(HOME_REMOTE_WINDOW, 'updateInstallAndRestart', [{ password: 'work-secret' }])).toEqual({ ok: true })
    expect(work.passwords).toEqual(['wrong', 'work-secret'])
    expect(work.restarts).toHaveLength(1)
    expect(work.service.current().phase).toBe('restarting')
    expect(home.passwords).toEqual([])
    expect(home.restarts).toEqual([])
    expect(home.service.current().phase).toBe('idle')
  })

  it('opening the installer is refused in a remote window: it would open on the work machine\'s screen', async () => {
    await expect(Promise.resolve().then(() => call(HOME_REMOTE_WINDOW, 'updateOpenDownloaded'))).rejects.toThrow()
  })
})
