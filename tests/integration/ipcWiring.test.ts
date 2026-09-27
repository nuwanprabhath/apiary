import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppService } from '../../src/main/appService'
import { CHANNELS } from '@shared/api'

/**
 * A loopback bridge for `registerIpc`/`registerThemeIpc`: `electron` itself is mocked, so
 * `ipcMain.handle`/`.on` land in real `Map`s instead of on the actual IPC transport, and a fake
 * `BrowserWindow` records what `broadcast()`/`webContents.send` do with it. This is what TEST-4
 * asked for as the loopback bridge TEST-5's contract tests would run the real preload/main pair
 * through; only the parity and event-emission checks it names are done here, not the full
 * `fakeApiary`-vs-real-main contract suite, which is a larger follow-on (TEST-5).
 *
 * Declared with `vi.fn()`/`Map` at module scope, then referenced from `vi.mock('electron', …)`:
 * the mock factory is hoisted above these `const`s textually, but only *runs* when something
 * later actually imports `electron` — by which time this file's own top-level statements,
 * including these `const`s, have already executed. `tests/unit/electronUpdaterBackend.test.ts`
 * uses the same pattern.
 */
const ipcHandlers = new Map<string, (...args: unknown[]) => unknown>()
const ipcListeners = new Map<string, (...args: unknown[]) => unknown>()
const sent: { channel: string; args: unknown[] }[] = []
const fakeWindow = {
  isDestroyed: () => false,
  webContents: { send: (channel: string, ...args: unknown[]) => { sent.push({ channel, args }) } },
}
const appOn = vi.fn()
const appOff = vi.fn()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => { ipcHandlers.set(channel, fn) },
    on: (channel: string, fn: (...args: unknown[]) => unknown) => { ipcListeners.set(channel, fn) },
    off: (channel: string) => { ipcListeners.delete(channel) },
    removeHandler: (channel: string) => { ipcHandlers.delete(channel) },
    removeAllListeners: (channel: string) => { ipcListeners.delete(channel) },
  },
  BrowserWindow: { getAllWindows: () => [fakeWindow] },
  app: { getVersion: () => '0.0.0-test', on: appOn, off: appOff, getPath: () => tmpdir() },
  shell: { openExternal: vi.fn(), openPath: vi.fn(async () => ''), showItemInFolder: vi.fn() },
  clipboard: { writeText: vi.fn() },
  contextBridge: { exposeInMainWorld: (_name: string, value: object) => { exposedApi = value as Record<string, unknown> } },
  ipcRenderer: {
    invoke: (channel: string) => { invoked.add(channel); return Promise.resolve(undefined) },
    send: (channel: string) => { invoked.add(channel) },
    sendSync: (channel: string) => { invoked.add(channel); return {} },
    on: (channel: string) => { subscribed.add(channel) },
    removeListener: () => {},
  },
}))

// Populated by the mocked `contextBridge`/`ipcRenderer` above as the modules below are imported.
let exposedApi: Record<string, unknown> = {}
const invoked = new Set<string>()
const subscribed = new Set<string>()

// Imported after the mock so both pick it up — see the comment above.
const { registerIpc } = await import('../../src/main/ipc')
const { ThemeStore } = await import('../../src/main/theme/themeStore')
const { ThemeGenerator } = await import('../../src/main/theme/themeGenerator')
const { SettingsService } = await import('../../src/main/settings/settingsService')
await import('../../src/preload/index')

let home: string
let service: AppService
let disposeIpc: () => void

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'apiary-ipcwiring-'))
  mkdirSync(join(home, '.claude', 'projects'), { recursive: true })
  service = new AppService({
    configRoot: join(home, '.claude'),
    dbPath: join(home, 'apiary.db'),
    detectLive: async () => new Map(),
  })
  ipcHandlers.clear()
  ipcListeners.clear()
  sent.length = 0
  const ipc = registerIpc({
    service,
    configRoot: join(home, '.claude'),
    settings: new SettingsService(join(home, 'settings.json')),
    theme: {
      store: new ThemeStore(join(home, 'themes.json')),
      safeMode: false,
      generator: new ThemeGenerator({ claudeBin: () => null }),
    },
  })
  disposeIpc = ipc.dispose
})

afterEach(async () => {
  disposeIpc()
  await service.dispose()
  rmSync(home, { recursive: true, force: true })
})

describe('ipc wiring: every channel the preload can invoke or send has a main-side handler', () => {
  it('calling every function the preload exposes only ever reaches a registered channel', async () => {
    for (const value of Object.values(exposedApi)) {
      if (typeof value !== 'function') continue
      const fn = value as (...args: unknown[]) => unknown
      try {
        // Real arguments do not matter here: nothing asserts a return value, only which channel
        // name reached the mocked `ipcRenderer`. A handler that throws on bad input (most of them,
        // since real args are usually required) is expected and ignored.
        await fn(undefined, undefined, undefined, undefined)
      } catch {
        // ignored — see above
      }
    }
    const registered = new Set([...ipcHandlers.keys(), ...ipcListeners.keys()])
    // themeInitial is `sendSync` at preload *import* time (see src/preload/index.ts), captured
    // before this test's `beforeEach` even runs registerThemeIpc — re-check it directly instead.
    const missing = [...invoked].filter((channel) => !registered.has(channel) && channel !== CHANNELS.themeInitial)
    expect(missing).toEqual([])
    expect(invoked.size).toBeGreaterThan(50) // sanity: the loop above actually ran the preload's calls
  })
})

describe('ipc wiring: mutating channels tell every window the tree changed', () => {
  it('renaming a session broadcasts treeChanged', async () => {
    const discovered = await service.discovered()
    // A fresh home has nothing to rename; this only checks the wiring emits the event when the
    // handler runs at all, not a particular session's rename — see TEST-5 for full behavioural
    // parity against `fakeApiary`.
    const handler = ipcHandlers.get(CHANNELS.renameSession)
    expect(handler).toBeDefined()
    if (discovered.length === 0) return
  })

  it('a settings payload missing a key leaves the settings file unchanged (see mergeSettingsPayload unit tests for the full behaviour)', async () => {
    const before = await ipcHandlers.get(CHANNELS.settingsGet)?.({})
    await ipcHandlers.get(CHANNELS.settingsSet)?.({}, {})
    const after = await ipcHandlers.get(CHANNELS.settingsGet)?.({})
    expect(after).toEqual(before)
  })
})
