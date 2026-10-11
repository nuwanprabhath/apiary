import { app, BrowserWindow, Menu, dialog, session, webContents } from 'electron'
import { errorMessage } from '@shared/errors'
import { homedir, hostname } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type AppService } from './appService'
import { registerIpc } from './ipc'
import type { SessionLayoutStore } from './windows/sessionLayoutStore'
import { type LayoutFlushCoordinator } from './windows/layoutFlushCoordinator'
import type { TabRegistry } from './windows/tabRegistry'
import { pruneStaleLive } from './windows/sessionLayoutRestore'
import { readsClaudeKeychain, resolveConfigRoot } from './app/config'
import { createContainer, containerPaths } from './app/container'
import { buildMenu } from './app/menu'
import { writeZshShim } from './pty/promptPath'
import type { ThemeGenerator } from './theme/themeGenerator'
import type { PetService } from './pets/petService'
import type { SessionWatcher } from './sessions/sessionWatcher'
import { IPC } from '@shared/api'
import { type SettingsService } from './settings/settingsService'
import type { UpdateService } from './update/updateService'
import { log } from './log/logger'
import { configureLogging } from './log/configure'
import { detectVsCode } from './vscode/detectVsCode'
import { hasDeveloperIdSignature } from './update/macSignature'
import { parseRuntimeEnv, type RuntimeEnv } from './app/env'
import { installPermissionGuards } from './app/permissions'
import { broadcast, registerBroadcastSkip, registerBroadcastTargets } from './windows/broadcast'
import type { Container } from './app/container'
import type { RemoteClientService } from './remote/remoteClientService'
import type { RemoteHost } from '@shared/domain/remote'
import type { Dispatcher } from './ipc/registrar'
import { fireAndForget } from './log/fireAndForget'
import type { WindowManager } from './windows/windowManager'
import { installQuitDeferral } from './app/lifecycle'
import { sendEvent } from './windows/sendEvent'
import { shouldHoldSingleInstanceLock, shouldOpenFirstWindow, shouldQuitWhenNoWindows } from './app/launchMode'

const dirname = fileURLToPath(new URL('.', import.meta.url))

/**
 * Every test-only override and launch flag, parsed once (MAIN-15) — see `app/env.ts` for what
 * each one does and why a packaged build ignores all but `--safe-theme`.
 */
const env: RuntimeEnv = parseRuntimeEnv(process.env, process.argv, app.isPackaged)
const launchMode = { background: env.background }

// One Apiary per profile: a second launch (the user starting it normally after a background start)
// hands over to the running one, which opens a window.
if (shouldHoldSingleInstanceLock(launchMode, app.isPackaged)) {
  if (!app.requestSingleInstanceLock()) app.quit()
  else {
    app.on('second-instance', () => {
      if (!app.isReady()) return
      const front = windowManager?.front()
      if (front) front.focus()
      else windowManager?.create()
    })
  }
}

// Nothing in `src/main` registered either of these before (MAIN-19): an unobserved rejection was
// silent, and an uncaught exception took the whole process down with Electron's own native error
// dialog — no diagnostic recorded either way. The diagnostic log exists for exactly this ("Open
// installer", CLAUDE.md). Note that listening for `uncaughtException` replaces the default
// handling: Electron no longer shows its dialog, and the process carries on — as it already did
// after that dialog — so the log line is now the record of it.
process.on('unhandledRejection', (reason) => {
  log.error('process', 'unhandled rejection', {
    error: errorMessage(reason),
  })
})
process.on('uncaughtException', (error) => {
  log.error('process', 'uncaught exception', { error: error.message })
})

let service: AppService | null = null
let disposeIpc: (() => void) | null = null
let disposeRemote: (() => void) | null = null

/**
 * Runs the remote-access server while the "Allow remote access over SSH" setting is on: started
 * now if it is, and started or stopped as the setting changes. Returns the disposer for quit.
 */
function startRemoteAccess(container: Container, dispatcher: Dispatcher): () => void {
  const { remoteServer, virtualContents, settingsService: settings } = container
  remoteServer.attachDispatcher(dispatcher)
  container.hostDirectory.start()
  const disposeTargets = registerBroadcastTargets(() => virtualContents.list())
  const disposeSkip = registerBroadcastSkip(container.remoteWindows.skipsBroadcast)
  const apply = (on: boolean): void => {
    fireAndForget(on ? remoteServer.start() : remoteServer.stop(), 'remote')
  }
  if (settings.get().remoteAccess) apply(true)
  const unsubscribe = settings.onChange((next, prev) => {
    if (next.remoteAccess !== prev.remoteAccess) apply(next.remoteAccess)
  })
  return () => {
    unsubscribe()
    disposeTargets()
    disposeSkip()
    fireAndForget(remoteServer.stop(), 'remote')
    // Every ssh this app started stops with it.
    fireAndForget(container.remoteClient.dispose(), 'remote')
    container.hostDirectory.dispose()
  }
}
/** File → Open Remote Session → Other Host…: the front window shows the dialog; with no window (macOS keeps the app alive without one), a new one does once its page has loaded. */
function showRemoteDialog(): void {
  const front = windowManager?.front()
  if (front) { sendEvent(front.webContents, IPC.openRemoteDialog); return }
  const opened = windowManager?.open()
  if (opened === undefined) return
  const contents = webContents.fromId(opened.webContentsId)
  contents?.once('did-finish-load', () => { sendEvent(contents, IPC.openRemoteDialog) })
}

/** File → Open Remote Session → a host: the same path as the dialog's Connect; a failure shows over the focused window. */
function openRemoteHost(client: RemoteClientService, host: string): void {
  const connecting = client.connect(host).catch((error: unknown) => {
    const win = BrowserWindow.getFocusedWindow()
    const options = { type: 'error', title: 'Could not open the remote session', message: `Could not connect to ${host}`, detail: errorMessage(error) } as const
    return win !== null ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options)
  })
  fireAndForget(connecting, 'remote')
}

let sessionWatcher: SessionWatcher | null = null
/** Window creation, numbering and focus tracking (MAIN-15 step 3) — constructed once in `start()`,
 *  once its dependencies (`settingsService`, `sessionLayoutStore`, `tabRegistry`) exist. */
let windowManager: WindowManager | null = null
/** The single owner of `settings.json` (MAIN-16) — constructed once in `start()`. */
let settingsService: SettingsService | null = null
let sessionLayoutStore: SessionLayoutStore | null = null
let layoutFlushCoordinator: LayoutFlushCoordinator | null = null
let tabRegistry: TabRegistry | null = null
let updater: UpdateService | null = null
let themeGenerator: ThemeGenerator | null = null
let petService: PetService | null = null
let resetTheme: (route: string) => void = () => {}
let autoImportTimer: NodeJS.Timeout | null = null

/**
 * Starts, stops or re-times the periodic rescan.
 *
 * The chokidar watcher in ipc.ts already notices session files as they change, so this is not
 * about *those*: it is for the sessions that appear without any file this app is watching having
 * changed in a way it sees — one started in a terminal outside Apiary, most often. Off by default
 * (a null interval), because a machine with many projects pays a real cost per scan: every pass
 * shells out to git once per distinct project directory.
 *
 * Re-armed after each run rather than on a fixed `setInterval`, so a scan that outlives its own
 * interval on a slow machine can't have the next one stacked up behind it.
 */
function setAutoImportInterval(intervalMinutes: number | null): void {
  if (autoImportTimer) {
    clearTimeout(autoImportTimer)
    autoImportTimer = null
  }
  if (intervalMinutes === null || intervalMinutes <= 0) return
  const scheduleNextRefresh = (): void => {
    autoImportTimer = setTimeout(() => {
      // Every window, not just the front one (MAIN-12): a periodic rescan importing a session
      // discovered outside Apiary must not leave a background window's sidebar stale.
      const refresh = service?.refresh().then(() => broadcast(IPC.treeChanged))
      if (refresh) fireAndForget(refresh, 'auto-import')
      scheduleNextRefresh()
    }, intervalMinutes * 60 * 1000)
  }
  scheduleNextRefresh()
}

/**
 * `npm start` runs the bare Electron binary with no .app bundle, so the Dock has nothing to
 * read a custom icon from and falls back to Electron's own default — a packaged build never
 * needs this, since it takes its icon from the bundle itself (see `mac.icon` in
 * electron-builder.yml). `app.dock` only exists on macOS.
 */
function setDevDockIcon(): void {
  if (app.isPackaged || process.platform !== 'darwin') return
  // A headless test run has no window to show, so no Dock tile either: the suite launches the app
  // hundreds of times in a row, and the Dock fell behind and piled up a row of icons while it ran.
  if (headless) {
    app.dock?.hide()
    return
  }
  app.dock?.setIcon(join(dirname, '../../build/icon.png'))
}

/**
 * Whether to leave the window off-screen entirely.
 *
 * For test runs: a suite that steals focus and flashes windows for several minutes makes the
 * machine unusable while it runs. The renderer still runs, lays out and responds to input exactly
 * as it would visibly — Playwright drives it through the debugging protocol, which does not care
 * whether anything is on screen — so the tests exercise the same code either way.
 */
const headless = env.headless

/**
 * `File > New Session in Folder...`. The folder comes from Electron's own native picker, never
 * from the renderer, so it can be passed straight to `AppService.newSessionInFolder()` without
 * the store-lookup validation `newSessionInProject()` needs for a renderer-supplied identifier.
 */
async function onNewSessionInFolder(): Promise<void> {
  const mainWindow = windowManager?.front()
  if (!mainWindow || !service) return
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] })
  if (result.canceled || result.filePaths.length === 0) return
  try {
    const info = await service.newSessionInFolder(result.filePaths[0])
    sendEvent(mainWindow.webContents, IPC.newSessionStarted, info)
  } catch (e) {
    // Folder picked via a live native dialog should always exist; a spawn failure here has no
    // dedicated renderer-facing channel, so it is surfaced the same way other main-process
    // spawn errors that predate this feature are: logged rather than silently swallowed.
    console.error('Failed to start new session in folder:', e)
  }
}


async function start(): Promise<void> {
  setDevDockIcon()
  // Before any window is created: Electron's default is to grant every permission a page asks
  // for, and that default applies to any request made before a handler is registered (SEC-10).
  installPermissionGuards(session.defaultSession)
  const userData = app.getPath('userData')
  const paths = containerPaths(env, userData, resolveConfigRoot)
  // Test-only, like APIARY_GLAB_PATH: substitutes a fake `code` binary for E2E, and an empty
  // string simulates VS Code not being found at all. Undefined (never set outside tests) means
  // run the real detection.
  const codePathOverride = env.codePathOverride
  const vsCodePath = codePathOverride === undefined
    ? await detectVsCode()
    : (codePathOverride === '' ? null : codePathOverride)
  // Only a packaged macOS build with no fake update can ask `codesign` anything worth knowing.
  const fakeUpdate = env.fakeUpdate
  const macSigned = process.platform === 'darwin' && app.isPackaged && (fakeUpdate === undefined || fakeUpdate === '')
    && await hasDeveloperIdSignature()
  // Everything long-lived is built in `app/container.ts` (MAIN-15 step 5); what is left in this
  // function is the order things start in.
  const container = createContainer(env, paths, {
    vsCodePath,
    macSigned,
    // Rewritten every launch, so a new Apiary's shim replaces an old one's.
    zshPromptShim: writeZshShim(join(userData, 'prompt-shim', 'zsh')),
    dirname,
    statusBarKeychain: readsClaudeKeychain(process.platform, env.configRoot),
    isQuitting,
    homeDir: homedir(),
    host: hostname(),
    appVersion: app.getVersion(),
  })
  settingsService = container.settingsService
  sessionLayoutStore = container.sessionLayoutStore
  layoutFlushCoordinator = container.layoutFlushCoordinator
  tabRegistry = container.tabRegistry
  windowManager = container.windowManager
  service = container.service
  updater = container.updater
  themeGenerator = container.themeGenerator
  petService = container.petService
  const settings = settingsService.get()
  // Before anything else that might be worth recording. Off unless the user switched it on.
  configureLogging(settings)
  log.info('app', 'started', {
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    packaged: app.isPackaged,
  })
  container.spelling.restore(settings.proofingLanguage)
  // Before any window exists: each window asks for its theme synchronously as it loads.
  const safeTheme = env.safeTheme
  const ipc = registerIpc({
    service, chat: container.chat, plugins: container.plugins, spelling: container.spelling, folderBrowser: container.folderBrowser, state: container.ipcState, settings: settingsService, router: container.remoteWindows, remoteClient: container.remoteClient, hostDirectory: container.hostDirectory, remoteServer: container.remoteServer, remotePairing: container.remotePairing,
    pickFolder: async (sender) => {
      if (env.pickFolder !== undefined) return env.pickFolder
      const win = BrowserWindow.fromWebContents(sender)
      const options = { properties: ['openDirectory' as const], title: 'Start a Claude session in…' }
      const result = win !== null ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
      return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
    },
    onAutoImportIntervalChange: setAutoImportInterval,
    updater,
    sessionLayoutStore, layoutFlushCoordinator,
    tabRegistry, windowNumberFor: (id) => windowManager!.windowNumberFor(id),
    activeTabs: container.activeTabs,
    // SEC-8 step 8: the renderer is always loaded from one of these two places (see
    // `WindowManager.create` above) — a dev-server origin (`ELECTRON_RENDERER_URL`, test/dev only) or the
    // packaged app's own `renderer/index.html`. `parseRuntimeEnv` already keeps the dev-server URL
    // out of a packaged build's environment (SEC-3), so `devServerOrigin` is always null there.
    senderPolicy: { devServerOrigin: env.rendererUrl ? new URL(env.rendererUrl).origin : null },
    theme: {
      // APIARY_DEFAULT_THEME=original is test-only: the E2E suite is written against the original
      // look, so a fresh profile there starts on it rather than on the default theme.
      store: container.themeStore,
      safeMode: safeTheme,
      generator: themeGenerator,
    },
    pets: {
      store: container.petStore,
      service: container.petService,
      actions: (keys) => container.service.latestActions(keys),
      ...(env.petExportPath !== undefined ? { exportPath: env.petExportPath } : {}),
      ...(env.petImportPath !== undefined ? { importPath: env.petImportPath } : {}),
    },
  })
  resetTheme = ipc.resetTheme
  disposeIpc = ipc.dispose
  disposeRemote = startRemoteAccess(container, ipc.dispatcher)
  // New session files appear without a restart. Started before the first refresh, as it was when
  // `registerIpc` owned it, so a file written during that scan is not missed.
  sessionWatcher = container.sessionWatcher
  sessionWatcher.start()
  await service.refresh()
  // The first refresh runs before the window exists, so nothing is listening for `treeChanged`
  // yet — importing here, before the window is created, is what makes everything already be in
  // the tree by the time the sidebar first asks for it.
  if (settings.autoImportAll) {
    await service.importAllDiscovered()
  }
  setAutoImportInterval(settings.autoImportIntervalMinutes)
  // Before any window: a window with the themed title bar asks for this menu as it first renders
  // (see TitleBar.tsx), and on Linux a menu attached after a window exists can re-show its GTK bar.
  const installMenu = (hosts: RemoteHost[]): void => { Menu.setApplicationMenu(
    buildMenu(
      () => sendEvent(windowManager?.front()?.webContents, IPC.openImportDialog),
      () => {
        // Every window, not just the front one (MAIN-12): background windows kept a stale tree
        // after Rescan Sessions from the menu.
        const refresh = service?.refresh().then(() => broadcast(IPC.treeChanged))
        if (refresh) fireAndForget(refresh, 'rescan')
      },
      () => sendEvent(windowManager?.front()?.webContents, IPC.openSettingsDialog),
      () => { void onNewSessionInFolder() },
      () => windowManager!.create(),
      () => {
        // A manual check should show its answer, whatever the answer is, so the window comes to
        // the front and the banner reports "up to date" and errors as well as updates.
        windowManager?.front()?.show()
        void updater?.check({ manual: true })
      },
      () => sendEvent(windowManager?.front()?.webContents, IPC.toggleSidebar),
      () => { resetTheme('menu') },
      { hosts, onOpenHost: (host) => { openRemoteHost(container.remoteClient, host) }, onOtherHost: showRemoteDialog },
    ),
  ) }
  installMenu(container.hostDirectory.snapshot())
  container.hostDirectory.subscribe(installMenu) // rebuilt as the host cache changes
  // What the file held at launch: no window exists yet to have reported anything since.
  const stored = container.sessionLayoutStore.snapshot()
  const records = stored.windows
    .map((r) => pruneStaleLive(r, (id) => service!.sessionIsResumable(id)))
    .filter((r) => r.layout.panes.some((p) => p.tabs.length > 0))
  if (!shouldOpenFirstWindow(launchMode, false)) { /* background: no window until a normal launch */ } else if (records.length === 0) {
    windowManager.create()
  } else {
    // Advanced to the highest recorded window number before restore begins, so a freshly opened
    // window after restore does not collide with a recorded number.
    windowManager.advanceOpenedTo(Math.max(0, ...records.map((r) => r.number)))
    for (const record of records) {
      windowManager.create({ restore: record }) // never combined with { detach } — restored
      // windows are only ever opened here, never through the drag/tear-off or registerIpc code
      // paths.
    }
  }
  // Started after the window exists, so the first status push has somewhere to land.
  updater?.start()
  container.plugins.startStatusBar()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) windowManager!.create()
  })
}

// If `start()` throws — a locked or corrupt database, an unwritable userData directory writing
// the zsh shim, a native ABI mismatch (see CLAUDE.md's ABI trap) — the app previously showed
// nothing and logged nothing: no window is ever created, and there is no window to report an
// error to. Guarded here so a launch failure is at least visible and recorded (MAIN-19).
void app.whenReady().then(async () => {
  try {
    await start()
  } catch (error) {
    const message = errorMessage(error)
    log.error('app', 'failed to start', { error: message })
    dialog.showErrorBox('Apiary could not start', message)
    app.quit()
  }
})

// Deferred until the async shutdown() below actually finishes (MAIN-15 step 4) — see
// app/lifecycle.ts's own doc comment for why (the native-abort risk from a PTY event landing
// after Node's teardown has already started). `isQuitting` is what `WindowManager`'s `closed`
// handler reads to tell "the user closed this window" from "the app is quitting", above.
const { isQuitting } = installQuitDeferral(() => shutdown())

async function shutdown(): Promise<void> {
  try {
    // Before dispose(), so a pending rescan can never fire against a closed store.
    setAutoImportInterval(null)
    // An in-progress theme generation is `claude -p` running detached in its own process group
    // (themeGenerator.ts) — nothing on this path used to stop it, so it kept running, and
    // spending tokens, after Apiary had already quit (MAIN-20).
    themeGenerator?.cancel()
    // The pets' `claude -p` calls likewise.
    petService?.dispose()
    updater?.stop()
    // The renderer keeps its UI state (selected session, sidebar width, pins) in localStorage, and
    // Chromium commits that to disk on a batching timer rather than on write. Quitting shortly
    // after a change could therefore drop it — you would come back to the app having forgotten
    // which session you had open. This forces the pending write out before shutdown continues.
    session.defaultSession.flushStorageData()
    // Ask every window to report its layout right now, bypassing its own 500ms debounce, and wait
    // (briefly, bounded — the same shape as the PTY wait above) for each one's `reportLayout` to
    // actually land before writing the file. Without this, quitting within that debounce window
    // (e.g. closing the last tab in a pane, then Cmd+Q) would persist an already-stale layout.
    //
    // Per window, and every failure swallowed: a window can be destroyed between the
    // `isDestroyed()` check and the `send()` (there is no way to close that race from here), and
    // an unhandled throw at that point would take the flush, the dispose and the quit with it.
    // One window failing to report must cost only that window's layout, never the others'.
    if (layoutFlushCoordinator !== null) {
      const coordinator = layoutFlushCoordinator
      await Promise.all(BrowserWindow.getAllWindows().map(async (win) => {
        try {
          if (win.isDestroyed()) return
          const wait = coordinator.waitFor(win.webContents.id)
          sendEvent(win.webContents, IPC.requestLayoutFlush)
          await wait
        } catch (err) {
          log.warn('window', 'layout flush failed for a window', {
            error: errorMessage(err),
          })
        }
      }))
    }
    sessionLayoutStore?.flush()
  } finally {
    // Runs even if the layout side threw: the PTYs still have to be reaped before Electron starts
    // tearing the Node environment down (see the comment above `before-quit`), which is the whole
    // reason quitting is deferred at all.
    sessionWatcher?.dispose()
    disposeIpc?.()
    disposeRemote?.()
    await service?.dispose()
  }
}

app.on('window-all-closed', () => {
  if (shouldQuitWhenNoWindows(launchMode, process.platform)) app.quit()
})
