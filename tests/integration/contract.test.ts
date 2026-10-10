import { afterAll, vi } from 'vitest'
import { chmodSync, cpSync, mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ApiaryApi } from '@shared/api'
import type { ContextMenuParamsLike, EditCommand } from '@shared/domain/contextMenu'
import { STARTER_PET } from '@shared/pets/builtins'
import { BUILTIN_THEMES } from '@shared/theme/builtins'
import { defineBridgeContract, LONG_SESSION } from '../contract/bridgeContract'
import { BAR_ITEM, BAR_PLUGIN, CONSENT_ITEM, CONSENT_PLUGIN, FEED_VERSION, STATUS_ITEM, STATUS_PANEL, STATUS_PLUGIN, THIS_WINDOW, DETACHED_WINDOW_NUMBER } from '../contract/world'
import { addBareRemote, cloneInto, commitFile, git, makeRepoWithWorktree } from '../fixtures/gitRepo'
import { makeSession } from '../fixtures/makeSession'
import { STANDARD_SESSIONS as STD } from '../fixtures/standard'

/**
 * The real preload and the real main-process handlers, joined by an in-process loopback instead of
 * Electron's IPC (TEST-5). `electron` is mocked: `ipcMain.handle` fills a Map, `ipcRenderer.invoke`
 * calls out of it, a fake window's `webContents.send` feeds the listeners `ipcRenderer.on`
 * registered, and arguments and results go through `structuredClone` as they do on the wire (so a
 * function or class instance leaking across the bridge fails here). Behind it: a real `AppService`
 * over temp directories, real git, one fake window (`THIS_WINDOW`: number 1, a known rectangle).
 * The same spec runs against `fakeApiary` in tests/component/contract.test.tsx; see
 * tests/contract/bridgeContract.ts.
 *
 * What is real, and what stands in:
 * - git: real, over a repository with a worktree and a bare `origin`; `outside` below is how the
 *   rest of the world (a teammate pushing, a commit made in a terminal) reaches it.
 * - `claude`: never the user's. Chat sessions and new sessions run `tests/fixtures/fake-claude-chat.mjs`
 *   as their binary; the one-shot calls (a pet's design, a theme, a remark) run a script that prints
 *   a canned reply. Nothing here can reach the network or spend tokens.
 * - plugins: the registries are the real classes, holding two plugins built from `contract/world.ts`.
 * - updates: the real `UpdateService` behind its fixture backend (`APIARY_FAKE_UPDATE`'s), offering
 *   `FEED_VERSION`.
 * - not modelled: the background indexer's `treeChanged`, the filesystem watcher, native dialogs
 *   (the folder picker and the pet file dialogs answer from here), the OS clipboard and `shell`.
 *
 * Mock state is declared before `vi.mock` and read lazily by its factory, the same pattern as
 * tests/integration/ipcWiring.test.ts.
 */
// A test builds a repository, services and sometimes a chat process: roomy limits for a busy machine.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 })

type Handler = (...args: unknown[]) => unknown
const ipcHandlers = new Map<string, Handler>()
const ipcListeners = new Map<string, Handler>()
const rendererListeners = new Map<string, Set<Handler>>()
type ContextMenuListener = (event: unknown, params: ContextMenuParamsLike) => void
let contextMenuListeners: ContextMenuListener[] = []
let editLog: EditCommand[] = []
/** The window the loopback's `send`/`invoke` come from, and the only one that exists. */
const fakeContents = {
  id: THIS_WINDOW.number,
  once: () => {},
  on: (channel: string, fn: ContextMenuListener) => { if (channel === 'context-menu') contextMenuListeners.push(fn) },
  isDestroyed: () => false,
  getURL: () => `app://apiary/index.html?w=${String(THIS_WINDOW.number)}`,
  send: (channel: string, ...args: unknown[]) => {
    for (const fn of [...(rendererListeners.get(channel) ?? [])]) fn({}, ...structuredClone(args))
  },
  cut: () => { editLog.push({ action: 'cut' }) },
  copy: () => { editLog.push({ action: 'copy' }) },
  paste: () => { editLog.push({ action: 'paste' }) },
  selectAll: () => { editLog.push({ action: 'selectAll' }) },
  replaceMisspelling: (word: string) => { editLog.push({ action: 'replaceMisspelling', word }) },
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
/** What `shell.openExternal` was asked to open, and `clipboard.writeText` to hold, since the bridge was made. */
let openedUrls: string[] = []
let copiedText: string[] = []
let exposedApi: ApiaryApi | null = null
/** Read through a function: the compiler cannot see that loading the preload sets it. */
const exposed = (): ApiaryApi | null => exposedApi

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: Handler) => { ipcHandlers.set(channel, fn) },
    on: (channel: string, fn: Handler) => { ipcListeners.set(channel, fn) },
    off: (channel: string) => { ipcListeners.delete(channel) },
    removeHandler: (channel: string) => { ipcHandlers.delete(channel) },
    removeAllListeners: (channel: string) => { ipcListeners.delete(channel) },
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
    openExternal: vi.fn(async (url: string) => { openedUrls.push(url) }),
    openPath: vi.fn(async () => ''),
    showItemInFolder: vi.fn(),
  },
  clipboard: { writeText: vi.fn(async (text: string) => { copiedText.push(text) }) },
  contextBridge: { exposeInMainWorld: (_name: string, value: object) => { exposedApi = value as ApiaryApi } },
  ipcRenderer: {
    invoke: async (channel: string, ...args: unknown[]) => {
      const handler = ipcHandlers.get(channel)
      if (handler === undefined) throw new Error(`No handler registered for '${channel}'`)
      return structuredClone(await handler({ sender: fakeContents }, ...structuredClone(args)))
    },
    send: (channel: string, ...args: unknown[]) => { ipcListeners.get(channel)?.({ sender: fakeContents }, ...structuredClone(args)) },
    sendSync: (channel: string, ...args: unknown[]) => {
      const event: { returnValue: unknown } = { returnValue: undefined }
      ipcListeners.get(channel)?.(event, ...structuredClone(args))
      return structuredClone(event.returnValue)
    },
    on: (channel: string, fn: Handler) => {
      const set = rendererListeners.get(channel) ?? new Set()
      rendererListeners.set(channel, set)
      set.add(fn)
    },
    removeListener: (channel: string, fn: Handler) => { rendererListeners.get(channel)?.delete(fn) },
  },
}))

const { buildServices, buildIpcState } = await import('../fixtures/buildService')
const { registerIpc } = await import('../../src/main/ipc')
const { UNCHECKED_SENDERS } = await import('../../src/main/ipc/ipcSenderGuard')
const { watchContextMenu } = await import('../../src/main/windows/contextMenu')
const { ThemeStore } = await import('../../src/main/theme/themeStore')
const { ThemeGenerator } = await import('../../src/main/theme/themeGenerator')
const { ClaudeOneShot } = await import('../../src/main/claude/claudeOneShot')
const { PetStore } = await import('../../src/main/pets/petStore')
const { PetService } = await import('../../src/main/pets/petService')
const { SettingsService } = await import('../../src/main/settings/settingsService')
const { PluginRegistry } = await import('../../src/main/plugins/registry')
const { StatusBarRegistry } = await import('../../src/main/statusBar/registry')
const { TabRegistry } = await import('../../src/main/windows/tabRegistry')
const { WindowAttachments } = await import('../../src/main/windows/windowAttachments')
const { broadcast } = await import('../../src/main/windows/broadcast')
const { createUpdater } = await import('../../src/main/update/createUpdater')
const { SpellingService } = await import('../../src/main/spelling/spellingService')
const { IPC } = await import('@shared/api')

/** Speaks claude's chat protocol, for the chat and for any session the app starts. */
const FAKE_CLAUDE = resolve(__dirname, '../fixtures/fake-claude-chat.mjs')

/** A `claude -p` stand-in: answers by what the prompt asks for, from canned replies. */
function writeOneShot(dir: string): string {
  const envelope = (o: object): string => JSON.stringify({ type: 'result', is_error: false, ...o })
  const canned: Record<string, string> = {
    design: envelope({ structured_output: { ...STARTER_PET, name: 'Zed' } }),
    voice: envelope({ structured_output: { lines: { idle: ['Fresh one!'] } } }),
    comment: envelope({ result: 'Ooh, careful with that buffer!' }),
    chat: envelope({ result: 'Hello there!' }),
    theme: envelope({ structured_output: BUILTIN_THEMES[0].spec }),
  }
  for (const [name, body] of Object.entries(canned)) writeFileSync(join(dir, `${name}.json`), body)
  const script = join(dir, 'claude-one-shot')
  writeFileSync(script, [
    '#!/bin/sh',
    'for a; do last=$a; done',
    'case "$last" in',
    `  *"Design a tiny desktop pet"*) cat "${dir}/design.json" ;;`,
    `  *"Write fresh lines"*) cat "${dir}/voice.json" ;;`,
    `  *"peeking over at Claude"*) cat "${dir}/comment.json" ;;`,
    `  *"You design colour themes"*) cat "${dir}/theme.json" ;;`,
    `  *) cat "${dir}/chat.json" ;;`,
    'esac',
  ].join('\n'))
  chmodSync(script, 0o755)
  return script
}

/**
 * The repository the clauses use, built once for the file and copied for each test: a repository
 * `repo-c` on `main`, its worktree `repo-c-wt` on `feature/wt`, and a bare `origin` (which also has
 * `release/1`) that `main` tracks. Building it takes about a second of git; copying it, and telling
 * git where the copies are, a tenth of that.
 */
let template: string | null = null
afterAll(() => { if (template !== null) rmSync(template, { recursive: true, force: true }) })

function buildTemplate(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'apiary-contract-template-')))
  const { repoRoot } = makeRepoWithWorktree(dir)
  addBareRemote(repoRoot, join(dir, 'origin.git'))
  git(repoRoot, 'push', '-q', '-u', 'origin', 'main')
  git(repoRoot, 'push', '-q', 'origin', 'main:refs/heads/release/1')
  // `origin/HEAD` exists, as it does after a clone and, from git 2.48, after a fetch. The clauses
  // list branches with it set, so a bare "origin" listed as a remote branch fails them (B20).
  git(repoRoot, 'fetch', '-q')
  git(repoRoot, 'remote', 'set-head', 'origin', 'main')
  return dir
}

function copyRepositories(home: string): { repoRoot: string; worktreeDir: string; remote: string } {
  template ??= buildTemplate()
  const [repoRoot, worktreeDir, remote] = ['repo-c', 'repo-c-wt', 'origin.git'].map((name) => join(home, name))
  for (const name of ['repo-c', 'repo-c-wt', 'origin.git']) cpSync(join(template, name), join(home, name), { recursive: true })
  git(repoRoot, 'remote', 'set-url', 'origin', remote)
  git(repoRoot, 'worktree', 'repair', worktreeDir)
  return { repoRoot, worktreeDir, remote }
}

defineBridgeContract('real preload + main handlers (loopback)', async ({ imported = true, longSessionMessages, liveSession, cancelPicker = false }) => {
  openedUrls = []
  copiedText = []
  editLog = []
  contextMenuListeners = []
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'apiary-contract-')))
  const projects = join(home, '.claude', 'projects')
  mkdirSync(projects, { recursive: true })
  const workA = join(home, 'work-a')
  const workB = join(home, 'work-b')
  const picked = join(home, 'picked')
  for (const dir of [workA, workB, picked]) mkdirSync(dir)
  const { repoRoot, worktreeDir, remote } = copyRepositories(home)

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
  let pushed = 0
  let madeHere = 0
  const oneShot = writeOneShot(home)
  const makeRunner = (): InstanceType<typeof ClaudeOneShot> => new ClaudeOneShot({ claudeBin: () => oneShot, shell: '/bin/sh' })

  const plugins = new PluginRegistry({ onChanged: () => { broadcast(IPC.pluginsChanged) } })
  plugins.register({
    ...BAR_PLUGIN,
    settings: [...BAR_PLUGIN.fields],
    evaluate: async () => ({ ...BAR_ITEM }),
  })
  const statusBar = new StatusBarRegistry({ onChanged: () => { broadcast(IPC.statusBarChanged) } })
  let meterChanged: (() => void) | null = null
  statusBar.register({
    ...STATUS_PLUGIN,
    settings: [...STATUS_PLUGIN.fields],
    start: (ctx) => { meterChanged = () => { ctx.changed() } },
    stop: () => { meterChanged = null },
    items: () => [{ ...STATUS_ITEM }],
    refresh: async () => { meterChanged?.() },
    panel: async () => STATUS_PANEL,
  }, true)
  // Shows its question until it has an answer; once answered it has nothing to show.
  let asked = true
  statusBar.register({
    ...CONSENT_PLUGIN,
    settings: [...CONSENT_PLUGIN.fields],
    start: () => {},
    stop: () => {},
    items: () => (asked ? [{ ...CONSENT_ITEM }] : []),
    refresh: async () => {},
    answerConsent: () => { asked = false },
  }, true)

  const tabRegistry = new TabRegistry()
  const built = buildServices({
    configRoot: join(home, '.claude'),
    dbPath: join(home, 'apiary.db'),
    detectLive: async () => (liveSession === undefined ? new Map() : new Map([[liveSession, 4242]])),
    claudeBin: FAKE_CLAUDE,
    tabs: tabRegistry,
    chat: {
      attachments: new WindowAttachments((id) => (id === fakeContents.id ? fakeContents : null)),
      announce: (change) => { broadcast(IPC.chatLifecycle, change) },
      activityChanged: () => { broadcast(IPC.activeTabsChanged) },
    },
    deps: { plugins, statusBar },
  })
  const service = built.service
  service.plugins.startStatusBar()

  const settings = new SettingsService(join(home, 'settings.json'))
  const petStore = new PetStore(join(home, 'pets.json'))
  const petService = new PetService({
    store: petStore, makeRunner, onChanged: () => { broadcast(IPC.petsChanged, petService.state()) },
  })
  const petFile = join(home, 'pet.apiarypet.json')
  const ipc = registerIpc({
    senderPolicy: UNCHECKED_SENDERS,
    service,
    chat: service.chat,
    plugins: service.plugins,
    activeTabs: built.activeTabs,
    spelling: new SpellingService(),
    state: buildIpcState(service, join(home, '.claude'), {
      tabRegistry,
      windowNumberFor: (id) => (id === fakeContents.id ? THIS_WINDOW.number : null),
      openDetachedWindow: () => DETACHED_WINDOW_NUMBER,
    }),
    settings,
    tabRegistry,
    windowNumberFor: (id) => (id === fakeContents.id ? THIS_WINDOW.number : null),
    pickFolder: async () => (cancelPicker ? null : picked),
    updater: createUpdater(settings, { fakeUpdate: FEED_VERSION, fakeUpdateMode: undefined }, false),
    theme: {
      store: new ThemeStore(join(home, 'themes.json'), null),
      safeMode: false,
      generator: new ThemeGenerator({ runner: makeRunner() }),
    },
    pets: { store: petStore, service: petService, actions: (keys) => service.latestActions(keys), exportPath: petFile, importPath: petFile },
  })
  // windowManager.create() does this for each real window; the loopback makes none.
  watchContextMenu(fakeContents)
  // The preload reads `initialTheme` once, as it loads, so it is loaded after the handlers exist.
  exposedApi = null
  vi.resetModules()
  await import('../../src/preload/index')
  const api = exposed()
  if (api === null) throw new Error('the preload did not expose window.apiary')

  // As at startup: scan the disk once, then (optionally) import everything found.
  await service.refresh()
  if (imported) {
    const all = await api.discovered()
    await api.importSessions(all.map((s) => s.sessionId), [])
  }

  return {
    api,
    folders: { workA, workB, repo: repoRoot, worktree: worktreeDir, picked },
    openedUrls: () => [...openedUrls],
    copied: () => [...copiedText],
    editing: () => [...editLog],
    rightClick: (params: ContextMenuParamsLike) => { for (const fn of contextMenuListeners) fn({}, params) },
    outside: {
      commitLocally: async () => {
        madeHere += 1
        commitFile(repoRoot, 'local.txt', `a commit made in a terminal (${String(madeHere)})`)
      },
      advanceRemote: async () => {
        const mate = mkdtempSync(join(home, 'mate-'))
        cloneInto(remote, mate)
        pushed += 1
        commitFile(mate, 'theirs.txt', `a commit a teammate pushed (${String(pushed)})`)
        git(mate, 'push', '-q')
      },
    },
    cleanup: async () => {
      ipc.dispose()
      await service.dispose()
      rmSync(home, { recursive: true, force: true })
    },
  }
})
