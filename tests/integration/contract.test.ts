import { vi } from 'vitest'
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ApiaryApi } from '@shared/api'
import { AppService } from '../../src/main/appService'
import { defineBridgeContract, LONG_SESSION } from '../contract/bridgeContract'
import { makeRepoWithWorktree } from '../fixtures/gitRepo'
import { makeSession } from '../fixtures/makeSession'
import { STANDARD_SESSIONS as STD } from '../fixtures/standard'

/**
 * The real preload and the real main-process handlers, joined by an in-process loopback instead of
 * Electron's IPC (TEST-5). `electron` is mocked: `ipcMain.handle` fills a Map, `ipcRenderer.invoke`
 * calls out of it, a fake window's `webContents.send` feeds the listeners `ipcRenderer.on`
 * registered, and arguments and results go through `structuredClone` as they do on the wire (so a
 * function or class instance leaking across the bridge fails here). Behind it: a real `AppService`
 * over temp directories, real git, no window. The same spec runs against `fakeApiary` in
 * tests/component/contract.test.tsx; see tests/contract/bridgeContract.ts.
 *
 * Mock state is declared before `vi.mock` and read lazily by its factory, the same pattern as
 * tests/integration/ipcWiring.test.ts.
 */
type Handler = (...args: unknown[]) => unknown
const ipcHandlers = new Map<string, Handler>()
const ipcListeners = new Map<string, Handler>()
const rendererListeners = new Map<string, Set<Handler>>()
const fakeWindow = {
  isDestroyed: () => false,
  webContents: {
    send: (channel: string, ...args: unknown[]) => {
      for (const fn of [...(rendererListeners.get(channel) ?? [])]) fn({}, ...structuredClone(args))
    },
  },
}
let exposedApi: ApiaryApi | null = null

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: Handler) => { ipcHandlers.set(channel, fn) },
    on: (channel: string, fn: Handler) => { ipcListeners.set(channel, fn) },
    off: (channel: string) => { ipcListeners.delete(channel) },
    removeHandler: (channel: string) => { ipcHandlers.delete(channel) },
    removeAllListeners: (channel: string) => { ipcListeners.delete(channel) },
  },
  BrowserWindow: { getAllWindows: () => [fakeWindow] },
  app: { getVersion: () => '0.0.0-test', on: vi.fn(), off: vi.fn(), getPath: () => tmpdir() },
  shell: { openExternal: vi.fn(), openPath: vi.fn(async () => ''), showItemInFolder: vi.fn() },
  clipboard: { writeText: vi.fn() },
  contextBridge: { exposeInMainWorld: (_name: string, value: object) => { exposedApi = value as ApiaryApi } },
  ipcRenderer: {
    invoke: async (channel: string, ...args: unknown[]) => {
      const handler = ipcHandlers.get(channel)
      if (handler === undefined) throw new Error(`No handler registered for '${channel}'`)
      return structuredClone(await handler({}, ...structuredClone(args)))
    },
    send: (channel: string, ...args: unknown[]) => { ipcListeners.get(channel)?.({}, ...structuredClone(args)) },
    sendSync: () => ({}),
    on: (channel: string, fn: Handler) => {
      const set = rendererListeners.get(channel) ?? new Set()
      rendererListeners.set(channel, set)
      set.add(fn)
    },
    removeListener: (channel: string, fn: Handler) => { rendererListeners.get(channel)?.delete(fn) },
  },
}))

const { registerIpc } = await import('../../src/main/ipc')
const { ThemeStore } = await import('../../src/main/theme/themeStore')
const { ThemeGenerator } = await import('../../src/main/theme/themeGenerator')
const { PetStore } = await import('../../src/main/pets/petStore')
const { PetService } = await import('../../src/main/pets/petService')
const { SettingsService } = await import('../../src/main/settings/settingsService')
await import('../../src/preload/index')

defineBridgeContract('real preload + main handlers (loopback)', async ({ imported = true, longSessionMessages }) => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'apiary-contract-')))
  const projects = join(home, '.claude', 'projects')
  mkdirSync(projects, { recursive: true })
  const workA = join(home, 'work-a')
  const workB = join(home, 'work-b')
  mkdirSync(workA)
  mkdirSync(workB)
  const { repoRoot, worktreeDir } = makeRepoWithWorktree(home)

  makeSession(projects, STD.csv.slug, { sessionId: STD.csv.id, cwd: workA, title: STD.csv.title, firstPrompt: STD.csv.firstPrompt })
  makeSession(projects, STD.switcher.slug, { sessionId: STD.switcher.id, cwd: workB, title: STD.switcher.title })
  makeSession(projects, STD.repoRoot.slug, { sessionId: STD.repoRoot.id, cwd: repoRoot, title: STD.repoRoot.title })
  makeSession(projects, STD.worktree.slug, {
    sessionId: STD.worktree.id, cwd: worktreeDir, gitBranch: 'feature/wt', title: STD.worktree.title,
  })
  if (longSessionMessages !== undefined) {
    // makeSession writes the first prompt and the closing "done" itself; the rest are padding.
    makeSession(projects, '-work-a-long', {
      sessionId: LONG_SESSION.id, cwd: workA, title: LONG_SESSION.title, padTurns: longSessionMessages - 2,
    })
  }

  ipcHandlers.clear()
  ipcListeners.clear()
  rendererListeners.clear()
  const service = new AppService({
    configRoot: join(home, '.claude'),
    dbPath: join(home, 'apiary.db'),
    detectLive: async () => new Map(),
  })
  const ipc = registerIpc({
    service,
    configRoot: join(home, '.claude'),
    settings: new SettingsService(join(home, 'settings.json')),
    theme: {
      store: new ThemeStore(join(home, 'themes.json')),
      safeMode: false,
      generator: new ThemeGenerator({ claudeBin: () => null }),
    },
    pets: (() => {
      const store = new PetStore(join(home, 'pets.json'))
      return { store, service: new PetService({ store, claudeBin: () => null, onChanged: () => {} }), actions: async () => [] }
    })(),
  })
  if (exposedApi === null) throw new Error('the preload did not expose window.apiary')
  const api = exposedApi

  // As at startup: scan the disk once, then (optionally) import everything found.
  await service.refresh()
  if (imported) {
    const all = await api.discovered()
    await api.importSessions(all.map((s) => s.sessionId), [])
  }

  return {
    api,
    folders: { workA, workB },
    cleanup: async () => {
      ipc.dispose()
      await service.dispose()
      rmSync(home, { recursive: true, force: true })
    },
  }
})
