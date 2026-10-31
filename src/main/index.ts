import { app, BrowserWindow, Menu, dialog, session, webContents, type WebContents } from 'electron'
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
import { createContainer } from './app/container'
import { containerPaths } from './app/containerPaths'
import { resolveResourcesDir } from './app/resourcesDir'
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
import type { KnowledgeParts } from './app/knowledgeContainer'
import type { RemoteClientService } from './remote/remoteClientService'
import type { RemoteHost } from '@shared/domain/remote'
import type { Dispatcher } from './ipc/registrar'
import { fireAndForget } from './log/fireAndForget'
import type { WindowManager } from './windows/windowManager'
import { installQuitDeferral } from './app/lifecycle'
import { sendEvent } from './windows/sendEvent'
import { shouldHoldSingleInstanceLock, shouldOpenFirstWindow, shouldQuitIdleBackground, shouldQuitWhenNoWindows } from './app/launchMode'

const dirname = fileURLToPath(new URL('.', import.meta.url))

/** Every test-only override and launch flag; see `app/env.ts`. */
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

// Listening for `uncaughtException` replaces Electron's native error dialog; the log line is the record.
process.on('unhandledRejection', (reason) => {
  log.error('process', 'unhandled rejection', {
    error: errorMessage(reason),
  })
})
process.on('uncaughtException', (error) => {
  log.error('process', 'uncaught exception', { error: error.message })
})

let service: AppService | null = null
let knowledge: KnowledgeParts | null = null
let disposeIpc: (() => void) | null = null
let disposeRemote: (() => Promise<void>) | null = null
/** Stops every resident's claude and the MCP server. */
let disposeResidents: (() => Promise<void>) | null = null
/** Quits a background-started app with no window and remote access off; set once remote access starts. */
let quitIfIdleBackground: () => void = () => {}

/** Runs the remote-access server while "Allow remote access over SSH" is on, following the setting. Returns the disposer for quit. */
function startRemoteAccess(container: Container, dispatcher: Dispatcher): () => Promise<void> {
  const { remoteServer, virtualContents, settingsService: settings } = container
  remoteServer.attachDispatcher(dispatcher)
  container.hostDirectory.start()
  const disposeTargets = registerBroadcastTargets(() => virtualContents.list())
  const disposeSkip = registerBroadcastSkip(container.remoteWindows.skipsBroadcast)
  const apply = (on: boolean): void => {
    // The refusal itself reaches Settings through `remoteServerState`; here it only decides whether to quit.
    const run = on ? remoteServer.start() : remoteServer.stop()
    fireAndForget(run.finally(() => { if (on) quitIfIdleBackground() }), 'remote')
  }
  // A background start with remote access off, or refused, has no window and no server: nothing would show it is running.
  quitIfIdleBackground = (): void => {
    const remoteAccess = settings.get().remoteAccess
    const serverFailed = remoteServer.serverState().state === 'failed'
    if (!shouldQuitIdleBackground(launchMode, remoteAccess, BrowserWindow.getAllWindows().length, serverFailed)) return
    log.info('remote', 'background start with no remote server and no window; quitting', { serverFailed })
    app.quit()
  }
  if (settings.get().remoteAccess) apply(true)
  else quitIfIdleBackground()
  const unsubscribe = settings.onChange((next, prev) => {
    if (next.remoteAccess === prev.remoteAccess) return
    apply(next.remoteAccess)
    quitIfIdleBackground()
  })
  return async () => {
    unsubscribe()
    disposeTargets()
    disposeSkip()
    container.hostDirectory.dispose()
    // Waited for: the socket and the /tmp directories are removed before the process exits.
    await Promise.all([remoteServer.stop(), container.remoteClient.dispose()])
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
let windowManager: WindowManager | null = null
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
 * Starts, stops or re-times the periodic rescan, for sessions that appear without a watched file
 * changing (one started in a terminal outside Apiary). Off by default (null interval): every pass
 * shells out to git once per project directory.
 *
 * Re-armed after each run rather than a `setInterval`, so a slow scan is not stacked behind itself.
 */
function setAutoImportInterval(intervalMinutes: number | null): void {
  if (autoImportTimer) {
    clearTimeout(autoImportTimer)
    autoImportTimer = null
  }
  if (intervalMinutes === null || intervalMinutes <= 0) return
  const scheduleNextRefresh = (): void => {
    autoImportTimer = setTimeout(() => {
      // Every window, so a background window's sidebar is not stale.
      const refresh = service?.refresh().then(() => broadcast(IPC.treeChanged))
      if (refresh) fireAndForget(refresh, 'auto-import')
      scheduleNextRefresh()
    }, intervalMinutes * 60 * 1000)
  }
  scheduleNextRefresh()
}

/**
 * `npm start` runs the bare Electron binary with no .app bundle, so the Dock shows Electron's
 * default icon; a packaged build takes it from the bundle (`mac.icon` in electron-builder.yml).
 * `app.dock` only exists on macOS.
 */
function setDevDockIcon(): void {
  if (app.isPackaged || process.platform !== 'darwin') return
  // The suite launches the app hundreds of times in a row, and the Dock piled up a row of icons.
  if (headless) {
    app.dock?.hide()
    return
  }
  app.dock?.setIcon(join(dirname, '../../build/icon.png'))
}

/** Test runs keep windows off-screen so the suite does not steal focus; the renderer behaves the same. */
const headless = env.headless

/** `File > New Session in Folder...`. The folder comes from the native picker, never the renderer, so it needs no store-lookup validation. */
async function onNewSessionInFolder(): Promise<void> {
  const mainWindow = windowManager?.front()
  if (!mainWindow || !service) return
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] })
  if (result.canceled || result.filePaths.length === 0) return
  try {
    const info = await service.newSessionInFolder(result.filePaths[0])
    sendEvent(mainWindow.webContents, IPC.newSessionStarted, info)
  } catch (e) {
    // No renderer-facing channel for a spawn failure here.
    console.error('Failed to start new session in folder:', e)
  }
}


/** The native folder picker, over the window that asked; `preset` answers instead in a test run. */
async function pickFolderOver(sender: WebContents, preset: string | undefined): Promise<string | null> {
  if (preset !== undefined) return preset
  const win = BrowserWindow.fromWebContents(sender)
  const options = { properties: ['openDirectory' as const], title: 'Start a Claude session in…' }
  const result = win !== null ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
}

async function start(): Promise<void> {
  setDevDockIcon()
  // Before any window: Electron grants every permission requested before a handler is registered.
  installPermissionGuards(session.defaultSession)
  const userData = app.getPath('userData')
  const paths = containerPaths(env, userData, resolveConfigRoot)
  // Test-only: a fake `code` binary for E2E; an empty string simulates VS Code not found.
  const codePathOverride = env.codePathOverride
  const vsCodePath = codePathOverride === undefined
    ? await detectVsCode()
    : (codePathOverride === '' ? null : codePathOverride)
  // Only a packaged macOS build with no fake update can ask `codesign` anything worth knowing.
  const fakeUpdate = env.fakeUpdate
  const macSigned = process.platform === 'darwin' && app.isPackaged && (fakeUpdate === undefined || fakeUpdate === '')
    && await hasDeveloperIdSignature()
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
    resourcesDir: resolveResourcesDir({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, appPath: app.getAppPath() }),
  })
  settingsService = container.settingsService
  ;({ sessionLayoutStore, layoutFlushCoordinator, tabRegistry, windowManager, service, knowledge } = container)
  updater = container.updater
  themeGenerator = container.themeGenerator
  petService = container.petService
  const settings = settingsService.get()
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
    service, chat: container.chat, plugins: container.plugins, spelling: container.spelling, folderBrowser: container.folderBrowser, library: container.library, accounts: container.accounts, residents: container.residents, state: container.ipcState, settings: settingsService, router: container.remoteWindows, remoteClient: container.remoteClient, hostDirectory: container.hostDirectory, remoteServer: container.remoteServer, remotePairing: container.remotePairing,
    pickFolder: (sender) => pickFolderOver(sender, env.pickFolder),
    onAutoImportIntervalChange: setAutoImportInterval,
    updater,
    sessionLayoutStore, layoutFlushCoordinator,
    tabRegistry, windowNumberFor: (id) => windowManager!.windowNumberFor(id),
    requireWindowWidth: (win, width) => { windowManager!.requireWidth(win, width) },
    activeTabs: container.activeTabs,
    // `parseRuntimeEnv` keeps the dev-server URL out of a packaged build, so the origin is null there.
    senderPolicy: { devServerOrigin: env.rendererUrl ? new URL(env.rendererUrl).origin : null },
    theme: {
      // APIARY_DEFAULT_THEME=original is test-only: the E2E suite is written against that look.
      store: container.themeStore,
      safeMode: safeTheme,
      generator: themeGenerator,
    },
    pets: {
      store: container.petStore,
      service: container.petService,
      placement: container.petPlacement,
      actions: (keys) => container.service.latestActions(keys),
      exportPath: env.petExportPath ?? null,
      importPath: env.petImportPath ?? null,
    },
  })
  resetTheme = ipc.resetTheme
  disposeIpc = ipc.dispose
  disposeRemote = startRemoteAccess(container, ipc.dispatcher)
  // Started before the first refresh, so a file written during that scan is not missed.
  sessionWatcher = container.sessionWatcher
  sessionWatcher.start()
  // A `/login` typed in an account's terminal shows only as the file Claude rewrites.
  container.accounts.startLoginChecks()
  await service.refresh()
  // Before the window exists, so everything is in the tree when the sidebar first asks.
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
        const refresh = service?.refresh().then(() => broadcast(IPC.treeChanged))
        if (refresh) fireAndForget(refresh, 'rescan')
      },
      () => sendEvent(windowManager?.front()?.webContents, IPC.openSettingsDialog),
      () => { void onNewSessionInFolder() },
      () => windowManager!.create(),
      () => {
        // A manual check shows its answer, "up to date" and errors included.
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
  log.info('window', 'restoring', {
    saved: stored.windows.map((r) => r.number), restoring: records.map((r) => r.number),
  })
  if (!shouldOpenFirstWindow(launchMode, false)) { /* background: no window until a normal launch */ } else if (records.length === 0) {
    windowManager.create()
  } else {
    windowManager.advanceOpenedTo(Math.max(0, ...records.map((r) => r.number)))
    for (const record of records) windowManager.create({ restore: record })
  }
  // Every window the restore will open is open: a pet whose window did not come back goes to one that did.
  container.petPlacement.start()
  // Started after the window exists, so the first status push has somewhere to land.
  updater?.start()
  container.plugins.startStatusBar()
  disposeResidents = container.residents.start()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) { windowManager!.create(); container.petPlacement.rehome() }
  })
}

// If `start()` throws (a corrupt database, an unwritable userData, a native ABI mismatch) no window
// exists to report it, so the failure is shown and logged here.
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

// Quit waits for `shutdown()`; see app/lifecycle.ts. `isQuitting` tells `WindowManager`'s `closed` handler a quit from a user closing a window.
const { isQuitting } = installQuitDeferral(() => shutdown())

async function shutdown(): Promise<void> {
  try {
    // Before dispose(), so a pending rescan can never fire against a closed store.
    setAutoImportInterval(null)
    // `claude -p` runs detached in its own process group (themeGenerator.ts): cancel it or it
    // keeps spending tokens after quit. The pets' calls likewise.
    themeGenerator?.cancel()
    petService?.dispose()
    updater?.stop()
    // Chromium commits localStorage (UI state) on a batching timer; a quick quit could drop it.
    session.defaultSession.flushStorageData()
    // Each window reports its layout now, bypassing its 500ms debounce, so a quit inside that
    // window does not persist a stale layout. A window can be destroyed between `isDestroyed()`
    // and `send()`, so each failure is swallowed to cost only that window's layout.
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
    // Even if the layout side threw: the PTYs must be reaped before Electron tears Node down.
    sessionWatcher?.dispose()
    disposeIpc?.()
    await disposeRemote?.()
    await disposeResidents?.()
    await service?.dispose()
    knowledge?.store.close()
  }
}

app.on('window-all-closed', () => {
  if (shouldQuitWhenNoWindows(launchMode, process.platform)) app.quit()
  else quitIfIdleBackground()
})
