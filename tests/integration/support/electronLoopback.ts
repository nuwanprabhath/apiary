import { vi } from 'vitest'
import { tmpdir } from 'node:os'
import type { ApiaryApi } from '@shared/api'
import type { ContextMenuParamsLike, EditCommand } from '@shared/domain/contextMenu'
import { THIS_WINDOW } from '../../contract/world'

/**
 * The `electron` stand-in both contract loopbacks (`contract.test.ts`, `remoteContract.test.ts`) run
 * on: `ipcMain.handle` fills a Map, `ipcRenderer.invoke` calls out of it, a fake window's
 * `webContents.send` feeds the listeners `ipcRenderer.on` registered, and arguments and results go
 * through `structuredClone` as they do on the wire (so a function or class instance leaking across
 * the bridge fails here). Each test file installs it with
 * `vi.mock('electron', async () => (await import('./support/electronLoopback')).electronMock())`.
 *
 * It imports nothing from `src/`, so loading it while `electron` is being mocked cannot loop.
 */

type Handler = (...args: unknown[]) => unknown
type ContextMenuListener = (event: unknown, params: ContextMenuParamsLike) => void

/** What the mock holds between calls; `resetLoopback` empties it for a new bridge. */
export const loopback = {
  ipcHandlers: new Map<string, Handler>(),
  ipcListeners: new Map<string, Handler>(),
  rendererListeners: new Map<string, Set<Handler>>(),
  contextMenuListeners: [] as ContextMenuListener[],
  editLog: [] as EditCommand[],
  /** What `shell.openExternal` was asked to open, and `clipboard.writeText` to hold, since the bridge was made. */
  openedUrls: [] as string[],
  copiedText: [] as string[],
  exposedApi: null as ApiaryApi | null,
}

export function resetLoopback(): void {
  loopback.openedUrls = []
  loopback.copiedText = []
  loopback.editLog = []
  loopback.contextMenuListeners = []
  loopback.ipcHandlers.clear()
  loopback.ipcListeners.clear()
  loopback.rendererListeners.clear()
  loopback.exposedApi = null
}

/** The window the loopback's `send`/`invoke` come from, and the only one that exists. */
export const fakeContents = {
  id: THIS_WINDOW.number,
  once: () => {},
  on: (channel: string, fn: ContextMenuListener) => { if (channel === 'context-menu') loopback.contextMenuListeners.push(fn) },
  isDestroyed: () => false,
  getURL: () => `app://apiary/index.html?w=${String(THIS_WINDOW.number)}`,
  send: (channel: string, ...args: unknown[]) => {
    for (const fn of [...(loopback.rendererListeners.get(channel) ?? [])]) fn({}, ...structuredClone(args))
  },
  cut: () => { loopback.editLog.push({ action: 'cut' }) },
  copy: () => { loopback.editLog.push({ action: 'copy' }) },
  paste: () => { loopback.editLog.push({ action: 'paste' }) },
  selectAll: () => { loopback.editLog.push({ action: 'selectAll' }) },
  replaceMisspelling: (word: string) => { loopback.editLog.push({ action: 'replaceMisspelling', word }) },
}

const fakeWindow = {
  isDestroyed: () => false,
  isMinimized: () => false,
  isVisible: () => true,
  restore: () => {},
  focus: () => {},
  getBounds: () => ({ ...THIS_WINDOW.bounds }),
  webContents: fakeContents,
}

export function electronMock(): object {
  return {
    ipcMain: {
      handle: (channel: string, fn: Handler) => { loopback.ipcHandlers.set(channel, fn) },
      on: (channel: string, fn: Handler) => { loopback.ipcListeners.set(channel, fn) },
      off: (channel: string) => { loopback.ipcListeners.delete(channel) },
      removeHandler: (channel: string) => { loopback.ipcHandlers.delete(channel) },
      removeAllListeners: (channel: string) => { loopback.ipcListeners.delete(channel) },
    },
    BrowserWindow: { getAllWindows: () => [fakeWindow] },
    webContents: { fromId: (id: number) => (id === fakeContents.id ? fakeContents : null) },
    app: {
      getVersion: () => '0.0.0-test', on: vi.fn(), off: vi.fn(), getPath: () => tmpdir(), isPackaged: false,
      getLocale: () => 'en-US', getSystemLocale: () => 'en-US',
    },
    session: {
      defaultSession: {
        availableSpellCheckerLanguages: ['de-DE', 'en-GB', 'en-US', 'es-ES', 'fr-FR'],
        setSpellCheckerLanguages: vi.fn(),
      },
    },
    shell: {
      openExternal: vi.fn(async (url: string) => { loopback.openedUrls.push(url) }),
      openPath: vi.fn(async () => ''),
      showItemInFolder: vi.fn(),
    },
    clipboard: { writeText: vi.fn(async (text: string) => { loopback.copiedText.push(text) }) },
    contextBridge: { exposeInMainWorld: (_name: string, value: object) => { loopback.exposedApi = value as ApiaryApi } },
    ipcRenderer: {
      invoke: async (channel: string, ...args: unknown[]) => {
        const handler = loopback.ipcHandlers.get(channel)
        if (handler === undefined) throw new Error(`No handler registered for '${channel}'`)
        return structuredClone(await handler({ sender: fakeContents }, ...structuredClone(args)))
      },
      send: (channel: string, ...args: unknown[]) => {
        loopback.ipcListeners.get(channel)?.({ sender: fakeContents }, ...structuredClone(args))
      },
      sendSync: (channel: string, ...args: unknown[]) => {
        const event: { returnValue: unknown } = { returnValue: undefined }
        loopback.ipcListeners.get(channel)?.(event, ...structuredClone(args))
        return structuredClone(event.returnValue)
      },
      on: (channel: string, fn: Handler) => {
        const set = loopback.rendererListeners.get(channel) ?? new Set()
        loopback.rendererListeners.set(channel, set)
        set.add(fn)
      },
      removeListener: (channel: string, fn: Handler) => { loopback.rendererListeners.get(channel)?.delete(fn) },
    },
  }
}
