import { app, BrowserWindow, Menu, dialog, session } from 'electron'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AppService } from './appService'
import { registerIpc } from './ipc'
import { createSessionLayoutStore, loadSessionLayout, type SessionLayoutStore } from './windows/sessionLayoutStore'
import { createLayoutFlushCoordinator, type LayoutFlushCoordinator } from './windows/layoutFlushCoordinator'
import { TabRegistry } from './windows/tabRegistry'
import { pruneStaleLive } from './windows/sessionLayoutRestore'
import { resolveConfigRoot } from './app/config'
import { buildMenu } from './app/menu'
import { ThemeStore, DEFAULT_THEME_ID } from './theme/themeStore'
import { writeZshShim } from './pty/promptPath'
import { ThemeGenerator } from './theme/themeGenerator'
import { CHANNELS } from '@shared/api'
import { SettingsService } from './settings/settingsService'
import type { UpdateService } from './update/updateService'
import { createUpdater } from './update/createUpdater'
import { log } from './log/logger'
import { configureLogging } from './log/configure'
import { detectVsCode } from './vscode/detectVsCode'
import { parseRuntimeEnv, type RuntimeEnv } from './app/env'
import { installPermissionGuards } from './app/permissions'
import { broadcast } from './windows/broadcast'
import { fireAndForget } from './log/fireAndForget'
import { WindowManager } from './windows/windowManager'
import { installQuitDeferral } from './app/lifecycle'

const dirname = fileURLToPath(new URL('.', import.meta.url))

/**
 * Every test-only override and launch flag, parsed once (MAIN-15) — see `app/env.ts` for what
 * each one does and why a packaged build ignores all but `--safe-theme`.
 */
const env: RuntimeEnv = parseRuntimeEnv(process.env, process.argv, app.isPackaged)

// Nothing in `src/main` registered either of these before (MAIN-19): an unobserved rejection was
// silent, and an uncaught exception took the whole process down with Electron's own native error
// dialog — no diagnostic recorded either way. The diagnostic log exists for exactly this ("Open
// installer", CLAUDE.md). Note that listening for `uncaughtException` replaces the default
// handling: Electron no longer shows its dialog, and the process carries on — as it already did
// after that dialog — so the log line is now the record of it.
process.on('unhandledRejection', (reason) => {
  log.error('process', 'unhandled rejection', {
    error: reason instanceof Error ? reason.message : String(reason),
  })
})
process.on('uncaughtException', (error) => {
  log.error('process', 'uncaught exception', { error: error.message })
})

let service: AppService | null = null
let disposeIpc: (() => void) | null = null
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
      const refresh = service?.refresh().then(() => broadcast(CHANNELS.treeChanged))
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
    mainWindow.webContents.send(CHANNELS.newSessionStarted, info)
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
  // Test-only overrides so E2E can run against fixture data.
  const configRoot = env.configRoot ?? resolveConfigRoot()
  const dbPath = env.dbPath ?? join(app.getPath('userData'), 'apiary.db')
  const fakeLive = env.fakeLive
  const settingsFile = join(app.getPath('userData'), 'settings.json')
  const sessionLayoutFile = join(app.getPath('userData'), 'session-layout.json')
  sessionLayoutStore = createSessionLayoutStore(sessionLayoutFile)
  layoutFlushCoordinator = createLayoutFlushCoordinator()
  tabRegistry = new TabRegistry()
  // Reads the file once, migrates it and writes the migration back — see `SettingsService`'s own
  // doc comment (MAIN-16). Every later read/write in this process goes through this one instance.
  settingsService = new SettingsService(settingsFile)
  windowManager = new WindowManager({
    settingsService,
    sessionLayoutStore,
    tabRegistry,
    headless,
    dirname,
    rendererUrl: env.rendererUrl,
    isQuitting,
  })
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
  // Test-only, like APIARY_GLAB_PATH: substitutes a fake `code` binary for E2E, and an empty
  // string simulates VS Code not being found at all. Undefined (never set outside tests) means
  // run the real detection.
  const codePathOverride = env.codePathOverride
  const vsCodePath = codePathOverride === undefined
    ? await detectVsCode()
    : (codePathOverride === '' ? null : codePathOverride)
  service = new AppService({
    configRoot,
    dbPath,
    claudeBin: settings.claudeBin ?? undefined,
    autoImportAll: settings.autoImportAll,
    searchChatContent: settings.searchChatContent,
    searchSessionNotes: settings.searchSessionNotes,
    promptPath: {
      enabled: settings.terminalShortenPath,
      segments: settings.terminalPathSegments,
      minimal: settings.terminalMinimalPrompt,
    },
    // Rewritten every launch, so a new Apiary's shim replaces an old one's.
    zshPromptShim: writeZshShim(join(app.getPath('userData'), 'prompt-shim', 'zsh')),
    plugins: settings.plugins,
    pluginSettings: settings.pluginSettings,
    // Test-only, like APIARY_FAKE_LIVE: points the merge-request plugin at a stand-in `glab`.
    glabPath: env.glabPath === '' ? undefined : env.glabPath,
    vsCodePath,
    onPluginsChanged: () => { broadcast(CHANNELS.pluginsChanged) },
    onIndexUpdated: () => { broadcast(CHANNELS.treeChanged) },
    detectLive: fakeLive !== undefined && fakeLive !== ''
      ? async () => new Map([[fakeLive, 4242]])
      : undefined,
  })
  updater = createUpdater(settingsService, env)
  // Before any window exists: each window asks for its theme synchronously as it loads.
  const safeTheme = env.safeTheme
  themeGenerator = new ThemeGenerator({ claudeBin: () => service?.claudeBin ?? null })
  const ipc = registerIpc({
    service, configRoot, settings: settingsService,
    onAutoImportIntervalChange: setAutoImportInterval,
    updater,
    sessionLayoutStore, layoutFlushCoordinator,
    openDetachedWindow: (tab, at) => windowManager!.create({ detach: tab, at }),
    tabRegistry, windowNumberFor: (id) => windowManager!.windowNumberFor(id),
    // SEC-8 step 8: the renderer is always loaded from one of these two places (see
    // `WindowManager.create` above) — a dev-server origin (`ELECTRON_RENDERER_URL`, test/dev only) or the
    // packaged app's own `renderer/index.html`. `parseRuntimeEnv` already keeps the dev-server URL
    // out of a packaged build's environment (SEC-3), so `devServerOrigin` is always null there.
    trustedRenderer: { devServerOrigin: env.rendererUrl ? new URL(env.rendererUrl).origin : null },
    theme: {
      // APIARY_DEFAULT_THEME=original is test-only: the E2E suite is written against the original
      // look, so a fresh profile there starts on it rather than on the default theme.
      store: new ThemeStore(join(app.getPath('userData'), 'themes.json'), env.defaultThemeOriginal ? null : DEFAULT_THEME_ID),
      safeMode: safeTheme,
      generator: themeGenerator,
    },
  })
  resetTheme = ipc.resetTheme
  disposeIpc = ipc.dispose
  await service.refresh()
  // The first refresh runs before the window exists, so nothing is listening for `treeChanged`
  // yet — importing here, before the window is created, is what makes everything already be in
  // the tree by the time the sidebar first asks for it.
  if (settings.autoImportAll) {
    await service.importAllDiscovered()
  }
  setAutoImportInterval(settings.autoImportIntervalMinutes)
  const stored = loadSessionLayout(sessionLayoutFile)
  const records = stored.windows
    .map((r) => pruneStaleLive(r, (id) => service!.sessionIsResumable(id)))
    .filter((r) => r.layout.panes.some((p) => p.tabs.length > 0))
  if (records.length === 0) {
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
  Menu.setApplicationMenu(
    buildMenu(
      () => windowManager?.front()?.webContents.send(CHANNELS.openImportDialog),
      () => {
        // Every window, not just the front one (MAIN-12): background windows kept a stale tree
        // after Rescan Sessions from the menu.
        const refresh = service?.refresh().then(() => broadcast(CHANNELS.treeChanged))
        if (refresh) fireAndForget(refresh, 'rescan')
      },
      () => windowManager?.front()?.webContents.send(CHANNELS.openSettingsDialog),
      () => { void onNewSessionInFolder() },
      () => windowManager!.create(),
      () => {
        // A manual check should show its answer, whatever the answer is, so the window comes to
        // the front and the banner reports "up to date" and errors as well as updates.
        windowManager?.front()?.show()
        void updater?.check({ manual: true })
      },
      () => windowManager?.front()?.webContents.send(CHANNELS.toggleSidebar),
      () => { resetTheme('menu') },
    ),
  )
  // Started after the window exists, so the first status push has somewhere to land.
  updater?.start()
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
    const message = error instanceof Error ? error.message : String(error)
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
          win.webContents.send(CHANNELS.requestLayoutFlush)
          await wait
        } catch (err) {
          log.warn('window', 'layout flush failed for a window', {
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }))
    }
    sessionLayoutStore?.flush()
  } finally {
    // Runs even if the layout side threw: the PTYs still have to be reaped before Electron starts
    // tearing the Node environment down (see the comment above `before-quit`), which is the whole
    // reason quitting is deferred at all.
    disposeIpc?.()
    await service?.dispose()
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
