import { afterAll } from 'vitest'
import { chmodSync, cpSync, mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { STARTER_PET } from '@shared/pets/builtins'
import { BUILTIN_THEMES } from '@shared/theme/builtins'
import { IPC } from '@shared/api'
import { LONG_SESSION } from '../../contract/bridgeContract'
import type { ContextMenuParamsLike } from '@shared/domain/contextMenu'
import type { Bridge, BridgeOptions } from '../../contract/support'
import { BAR_ITEM, BAR_PLUGIN, CONSENT_ITEM, CONSENT_PLUGIN, FEED_VERSION, STATUS_ITEM, STATUS_PANEL, STATUS_PLUGIN, BROWSE_HOME, THIS_WINDOW, DETACHED_WINDOW_NUMBER } from '../../contract/world'
import { addBareRemote, cloneInto, commitFile, git, makeRepoWithWorktree } from '../../fixtures/gitRepo'
import { makeSession } from '../../fixtures/makeSession'
import { STANDARD_SESSIONS as STD } from '../../fixtures/standard'
import { buildServices, buildIpcState } from '../../fixtures/buildService'
import type { Services } from '../../../src/main/app/container'
import { registerIpc } from '../../../src/main/ipc'
import { HostDirectory } from '../../../src/main/remote/hostDirectory'
import { PairingStore } from '../../../src/main/remote/pairingStore'
import { RemoteServer } from '../../../src/main/remote/remoteServer'
import { VirtualContentsRegistry as ClientRegistry } from '../../../src/main/remote/virtualContents'
import type { CallRouter } from '../../../src/main/ipc/registrar'
import { UNCHECKED_SENDERS } from '../../../src/main/ipc/ipcSenderGuard'
import { watchContextMenu } from '../../../src/main/windows/contextMenu'
import { ThemeStore } from '../../../src/main/theme/themeStore'
import { ThemeGenerator } from '../../../src/main/theme/themeGenerator'
import { ClaudeOneShot } from '../../../src/main/claude/claudeOneShot'
import { PetStore } from '../../../src/main/pets/petStore'
import { PetService } from '../../../src/main/pets/petService'
import { SettingsService } from '../../../src/main/settings/settingsService'
import { PluginRegistry } from '../../../src/main/plugins/registry'
import { StatusBarRegistry } from '../../../src/main/statusBar/registry'
import { TabRegistry } from '../../../src/main/windows/tabRegistry'
import { WindowAttachments } from '../../../src/main/windows/windowAttachments'
import { broadcast } from '../../../src/main/windows/broadcast'
import { createUpdater } from '../../../src/main/update/createUpdater'
import { SpellingService } from '../../../src/main/spelling/spellingService'
import { FolderBrowser } from '../../../src/main/folders/folderBrowser'
import type { Dispatcher } from '../../../src/main/ipc/registrar'
import type { VirtualContentsRegistry } from '../../../src/main/remote/virtualContents'
import { fakeContents, loopback, resetLoopback } from './electronLoopback'

/**
 * The world both contract loopbacks run in (`contract.test.ts`, `remoteContract.test.ts`): the
 * real preload and the real main-process handlers, over temp directories, real git and a fake
 * `claude`. See `contract.test.ts` for what is real and what stands in.
 */

export interface WorldExtras {
  /** Remote windows, which the pty and chat attachments find by id once they attach. */
  virtualContents?: VirtualContentsRegistry
  /** Routes the calls of a window that shows a work machine; none for the plain loopback. */
  router?: CallRouter
}

export interface LoopbackWorld {
  bridge: Bridge
  /** The dispatcher a `RemoteServer` serves its remote windows through. */
  dispatcher: Dispatcher
  /** What the work machine's `RemoteServer` resolves paths with. */
  vscode: Services['vscode']
}

/** Speaks claude's chat protocol, for the chat and for any session the app starts. */
const FAKE_CLAUDE = resolve(__dirname, '../../fixtures/fake-claude-chat.mjs')

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

let preloads = 0

export async function buildLoopbackWorld(
  { imported = true, longSessionMessages, liveSession, cancelPicker = false }: BridgeOptions,
  extras: WorldExtras = {},
): Promise<LoopbackWorld> {
  resetLoopback()
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'apiary-contract-')))
  const projects = join(home, '.claude', 'projects')
  mkdirSync(projects, { recursive: true })
  const workA = join(home, 'work-a')
  const workB = join(home, 'work-b')
  const picked = join(home, 'picked')
  for (const dir of [workA, workB, picked, join(workA, BROWSE_HOME.nested.child), join(workA, '.cache')]) mkdirSync(dir)
  const outsideDirs: string[] = []
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
      attachments: new WindowAttachments((id) => (id === fakeContents.id ? fakeContents : extras.virtualContents?.get(id) ?? null)),
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
  const remotePairing = new PairingStore(join(home, 'remote-pairing.json'), () => false)
  // Nothing connects to it here; it answers "nobody" and "Disconnect all" turns the setting off, as in the app.
  const remoteServer = new RemoteServer({
    homeDir: home, host: 'loopback', appVersion: '0.0.0', registry: new ClientRegistry(), layouts: () => [],
    turnOff: () => { settings.patch({ remoteAccess: false }) },
  })
  remoteServer.subscribe((clients) => { broadcast(IPC.remoteClientsChanged, clients) })
  const ipc = registerIpc({
    senderPolicy: UNCHECKED_SENDERS,
    remoteServer, remotePairing, remoteClient: null,
    router: extras.router ?? null,
    // No ssh, no ~/.ssh/config and no Tailscale here: only recent hosts could ever be listed.
    hostDirectory: new HostDirectory({
      file: join(home, 'remote-hosts.json'), homeDir: home, readText: () => null, sshConfig: undefined, now: () => Date.now(),
      exec: () => Promise.reject(new Error('no tailscale')), probeExec: () => Promise.reject(new Error('no ssh')),
    }),
    service,
    chat: service.chat,
    plugins: service.plugins,
    activeTabs: built.activeTabs,
    spelling: new SpellingService(),
    folderBrowser: new FolderBrowser({ home }),
    state: buildIpcState(service, join(home, '.claude'), {
      tabRegistry,
      ...(extras.virtualContents !== undefined ? { virtualContents: extras.virtualContents } : {}),
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
  // A query makes each bridge its own copy of the preload; the mocked `electron` it sees is shared.
  preloads += 1
  await import(/* @vite-ignore */ `../../../src/preload/index?bridge=${String(preloads)}`)
  const api = loopback.exposedApi
  if (api === null) throw new Error('the preload did not expose window.apiary')

  // As at startup: scan the disk once, then (optionally) import everything found.
  await service.refresh()
  if (imported) {
    const all = await api.discovered()
    await api.importSessions(all.map((s) => s.sessionId), [])
  }

  const bridge: Bridge = {
    api,
    folders: { workA, workB, repo: repoRoot, worktree: worktreeDir, picked },
    openedUrls: () => [...loopback.openedUrls],
    copied: () => [...loopback.copiedText],
    editing: () => [...loopback.editLog],
    rightClick: (params: ContextMenuParamsLike) => { for (const fn of loopback.contextMenuListeners) fn({}, params) },
    outside: {
      linkOutsideHome: async (name) => {
        const elsewhere = mkdtempSync(join(tmpdir(), 'apiary-contract-elsewhere-'))
        outsideDirs.push(elsewhere)
        symlinkSync(elsewhere, join(home, name))
      },
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
      for (const dir of outsideDirs) rmSync(dir, { recursive: true, force: true })
    },
  }
  return { bridge, dispatcher: ipc.dispatcher, vscode: built.vscode }
}
