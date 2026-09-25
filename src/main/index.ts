import { app, BrowserWindow, Menu, dialog, screen, session, shell } from 'electron'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AppService } from './appService'
import { registerIpc } from './ipc'
import { createSessionLayoutStore, loadSessionLayout, type SessionLayoutStore, type WindowLayoutRecord } from './sessionLayoutStore'
import { createLayoutFlushCoordinator, type LayoutFlushCoordinator } from './layoutFlushCoordinator'
import { TabRegistry } from './tabRegistry'
import { pruneStaleLive } from './sessionLayoutRestore'
import { resolveConfigRoot } from './config'
import { buildMenu } from './menu'
import { ThemeStore, DEFAULT_THEME_ID } from './theme/themeStore'
import { writeZshShim } from './pty/promptPath'
import { registerThemeIpc } from './theme/themeIpc'
import { ThemeGenerator } from './theme/themeGenerator'
import { CHANNELS } from '@shared/api'
import type { TabTransfer } from '@shared/types'
import { loadSettings, saveSettings } from './settings'
import { boundsAreOnScreen } from './windowBounds'
import { UpdateService, type UpdateSettings } from './update/updateService'
import { decideCapability } from './update/capability'
import { createUpdateBackend } from './update/electronUpdaterBackend'
import { hasDeveloperIdSignature } from './update/macSignature'
import { log } from './log/logger'
import { guardNavigation } from './navigationGuard'
import { configureLogging } from './log/configure'
import { detectVsCode } from './vscode/detectVsCode'

const dirname = fileURLToPath(new URL('.', import.meta.url))

let service: AppService | null = null
let disposeIpc: (() => void) | null = null
let mainWindow: BrowserWindow | null = null
/**
 * How many windows have ever been opened this run, which is what gives each one its identity.
 *
 * Windows share one main process — and therefore one set of sessions, terminals and settings — but
 * not one layout: which tabs and columns a window has open is its own. The renderer keys its
 * persisted layout on this number (see uiState.ts), so a second window is a second workspace over
 * the same sessions rather than a duplicate that fights the first over the same stored state.
 * Numbers are not reused, so closing window 2 and opening another gives a fresh workspace rather
 * than inheriting a dead one's arrangement.
 */
let windowsOpened = 0
let settingsFile = ''
let sessionLayoutStore: SessionLayoutStore | null = null
let layoutFlushCoordinator: LayoutFlushCoordinator | null = null
let tabRegistry: TabRegistry | null = null
/** `webContents.id` -> the window number it was created with, so a `reportTabs` call (which only
 *  carries the sender's webContents) can be filed under the same number `SessionLayoutStore` and
 *  the `?w=` URL already use for that window. Populated and cleared right alongside the window
 *  itself in `createWindow`, the same lifecycle `sessionLayoutStore`'s per-window bookkeeping follows. */
const windowNumberByWebContentsId = new Map<number, number>()
function windowNumberFor(webContentsId: number): number | null {
  return windowNumberByWebContentsId.get(webContentsId) ?? null
}
let updater: UpdateService | null = null
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
      void service?.refresh().then(() => mainWindow?.webContents.send(CHANNELS.treeChanged))
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
const headless = process.env.APIARY_HEADLESS === '1'

/**
 * A window that shows one session and nothing else.
 *
 * Dragging a tab out of the window, or `Move into New Window`, gives you the conversation and its
 * shell with no sidebar in the way — which is the point of the gesture: a session you want to read
 * or work in without the library beside it. The key travels in the URL for the same reason the
 * window number does (see below): the renderer needs it at first render, before an IPC round trip
 * could answer, or the window flashes the full layout before rearranging itself.
 */
export interface NewWindowOptions {
  /** The tab this window opens on its own, with no sidebar. */
  detach?: TabTransfer
  /** Where to put it — the pointer, when the window was made by dragging a tab out of another. */
  at?: { x: number; y: number }
  /** A window being recreated from the previous run's SessionLayoutStore record. */
  restore?: WindowLayoutRecord
}

function createWindow(opts: NewWindowOptions = {}): number {
  windowsOpened += 1
  const windowNumber = opts.restore?.number ?? windowsOpened
  const isFirst = windowNumber === 1

  const detached = opts.detach !== undefined

  const saved = loadSettings(settingsFile).windowBounds
  const restored =
    saved && boundsAreOnScreen(saved, screen.getAllDisplays().map((d) => d.workArea))
      ? saved
      : { width: 1400, height: 900 }
  // A restored window's own recorded bounds are more specific than the app's last-known single
  // position, so they take precedence over `restored` when they still land on a connected display.
  const restoreBounds = opts.restore !== undefined
    && boundsAreOnScreen(opts.restore.bounds, screen.getAllDisplays().map((d) => d.workArea))
    ? opts.restore.bounds
    : null
  // Only the first window restores its saved position. A second window opening exactly on top of
  // the first looks like nothing happened, so it cascades instead — the convention every
  // multi-window app uses, and the reason `windowNumber` is not reset.
  const offset = isFirst ? 0 : ((windowNumber - 1) % 5) * 30
  // `restoreBounds` takes precedence over the single-window `windowBounds` fallback: a restored
  // window's own recorded bounds are more specific than the app's last-known single position.
  const effectiveBounds: { x?: number; y?: number; width: number; height: number } = restoreBounds ?? restored
  const effectivePos = typeof effectiveBounds.x === 'number' && typeof effectiveBounds.y === 'number'
    ? { x: effectiveBounds.x, y: effectiveBounds.y }
    : null
  const bounds = restoreBounds !== null
    ? restoreBounds
    : isFirst && !detached
      ? effectiveBounds
      : {
        // A detached window has no sidebar, so it does not need the width for one — and a window
        // torn off by dragging should appear under the pointer that tore it off, not cascaded from
        // wherever the last window happened to be.
        width: detached ? Math.min(effectiveBounds.width, 1000) : effectiveBounds.width,
        height: effectiveBounds.height,
        ...(opts.at !== undefined
          ? { x: Math.round(opts.at.x - 120), y: Math.round(opts.at.y - 20) }
          : effectivePos !== null
            ? { x: effectivePos.x + offset, y: effectivePos.y + offset }
            : {}),
      }

  const win = new BrowserWindow({
    ...bounds,
    minWidth: detached ? 520 : 900,
    minHeight: 400,
    show: false,
    title: 'Apiary',
    // A *packaged* macOS app takes its window/dock icon from the .app bundle (see
    // `mac.icon` in electron-builder.yml) and ignores this option entirely — but `npm start`
    // runs the bare Electron binary with no bundle at all, so without setDevIcon() below the
    // Dock falls back to Electron's own default icon. Linux and Windows always read the icon
    // from the running process, packaged or not, so they need this option either way.
    // `build/icon.png` is listed in electron-builder.yml's `files`, so this same
    // project-relative path resolves both from the source tree in dev and from inside
    // app.asar once packaged.
    ...(process.platform === 'darwin'
      ? {}
      : { icon: join(dirname, '../../build/icon.png') }),
    webPreferences: {
      preload: join(dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // A window that is never shown is, as far as Chromium is concerned, a background window: it
      // throttles timers and stops servicing requestAnimationFrame. Both are load-bearing here
      // (the terminal fits itself in a rAF, the transcript scrolls in one), so a headless run
      // would hang on things that work perfectly when visible. Only relaxed when hidden — a
      // visible window should keep the power-saving behaviour it has always had.
      ...(headless ? { backgroundThrottling: false } : {}),
    },
  })
  log.info('window', 'created', { number: windowNumber, detached, at: opts.at !== undefined })
  guardNavigation(win.webContents, (url) => shell.openExternal(url))
  // Captured now, not read back off `win.webContents` in the `closed` handler below: by the time
  // `closed` fires the window (and its webContents) has already been destroyed, and touching
  // `win.webContents` at that point throws `Object has been destroyed` — uncaught, since `closed`
  // is an Electron event emitter callback, which took the whole main process down with a native
  // error dialog every time a window closed.
  const webContentsId = win.webContents.id
  windowNumberByWebContentsId.set(webContentsId, windowNumber)
  mainWindow = win
  // The menu and native dialogs act on whichever window is in front, so this follows focus rather
  // than staying pinned to the first window opened.
  win.on('focus', () => { mainWindow = win })

  // Only the first window's geometry is remembered in settings.json: with several open there is
  // no single "the window" to restore, and letting each one write would mean the last window
  // moved silently decides where the app opens next time. The session-layout store is different —
  // it tracks every window by number, so every window's bounds go there regardless.
  if (!detached) {
    const persistBounds = (): void => {
      const current = loadSettings(settingsFile)
      const normal = win.getNormalBounds()
      if (isFirst) saveSettings(settingsFile, { ...current, windowBounds: normal })
      sessionLayoutStore?.reportBounds(windowNumber, normal)
    }
    win.on('resized', persistBounds)
    win.on('moved', persistBounds)
  }
  win.on('closed', () => {
    // A window the user closed while carrying on working is genuinely gone and its record should
    // go with it. A window closing *because the app is shutting down* is not — and the ordinary
    // way to quit on Linux (and Windows) is the last window's X button, whose Electron ordering is
    // `closed` -> `window-all-closed` -> `app.quit()` -> `before-quit`. So by the time
    // `before-quit` flushes the store, the record it should be writing has already been deleted
    // and the file is written empty: the whole layout is discarded on every quit but Cmd+Q.
    //
    // A `quitting` flag alone cannot fix this, because nothing has decided to quit yet when
    // `closed` fires; neither can snapshotting in `before-quit`, which runs after the deletion.
    // What is knowable here is that no windows are left, and "no windows" is never a layout worth
    // persisting — there would be nothing to restore. So the last window out leaves its record
    // behind, and whatever comes next (a quit, or on macOS a new window from the dock reporting
    // its own layout) overwrites it.
    if (!quitting && BrowserWindow.getAllWindows().length > 0) {
      sessionLayoutStore?.removeWindow(windowNumber)
    }
    tabRegistry?.unregisterWindow(windowNumber)
    windowNumberByWebContentsId.delete(webContentsId)
    if (mainWindow === win) mainWindow = BrowserWindow.getAllWindows()[0] ?? null
  })

  // Deliberately never shown in headless mode: `show: false` above is the initial state, and this
  // is the line that would undo it.
  if (!headless) win.on('ready-to-show', () => win.show())

  // The window's number reaches the renderer through the URL rather than the preload bridge: it is
  // needed before anything else to pick which stored layout to load, and a query string is
  // available synchronously at first render.
  const query: Record<string, string> = { w: String(windowNumber) }
  if (opts.detach !== undefined) {
    query.detach = opts.detach.key
    // The rest of the tab rides alongside the key: which process it runs under and which shells
    // hang off it. See TabTransfer.
    query.transfer = JSON.stringify(opts.detach)
  }
  if (opts.restore !== undefined) {
    // `bounds` and `hasLayout` are stripped because the renderer never needs either: `bounds` is
    // a main/OS concept (consistent with the renderer never handling window geometry anywhere
    // else in this file), and `hasLayout` is main's own signal for whether a record is safe to
    // restore at all — by the time a record reaches here it has already passed that check (see
    // the `records` filter in `app.whenReady()`), so the renderer has nothing to do with it.
    query.restore = JSON.stringify({ ...opts.restore, bounds: undefined, hasLayout: undefined })
  }
  if (process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL)
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
    void win.loadURL(url.toString())
  } else {
    void win.loadFile(join(dirname, '../renderer/index.html'), { query })
  }
  return windowNumber
}


/**
 * `File > New Session in Folder...`. The folder comes from Electron's own native picker, never
 * from the renderer, so it can be passed straight to `AppService.newSessionInFolder()` without
 * the store-lookup validation `newSessionInProject()` needs for a renderer-supplied identifier.
 */
async function onNewSessionInFolder(): Promise<void> {
  if (!mainWindow || !service) return
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] })
  if (result.canceled || result.filePaths.length === 0) return
  try {
    const info = await service.newSessionInFolder(result.filePaths[0])
    mainWindow?.webContents.send(CHANNELS.newSessionStarted, info)
  } catch (e) {
    // Folder picked via a live native dialog should always exist; a spawn failure here has no
    // dedicated renderer-facing channel, so it is surfaced the same way other main-process
    // spawn errors that predate this feature are: logged rather than silently swallowed.
    console.error('Failed to start new session in folder:', e)
  }
}

/**
 * Builds the updater, or returns null where there is nothing it could do.
 *
 * The signature check is done once, here, by asking `codesign` what authority signed the running
 * bundle: an ad-hoc signature (what an unsigned build gets) has no Developer ID authority, and
 * Squirrel will refuse to replace such a bundle — see update/capability.ts. Doing it at startup
 * rather than at check time keeps the answer out of the path the user is waiting on.
 */
function createUpdater(settingsFile: string): UpdateService | null {
  const repo = 'nuwanprabhath/apiary'
  // Test-only: pretend a release exists, so the banner and the Settings panel can be driven
  // end-to-end. Nothing here reaches the network or the disk. Same shape as APIARY_FAKE_LIVE.
  const fake = process.env.APIARY_FAKE_UPDATE
  const faking = fake !== undefined && fake !== ''

  // 'auto' is a Linux AppImage (installs itself), 'deb' a Linux .deb (assisted, and the case that
  // cannot be opened by the OS at all), anything else an unsigned macOS build.
  const fakeMode = process.env.APIARY_FAKE_UPDATE_MODE
  const capabilityInput = faking
    ? {
      platform: fakeMode === 'auto' || fakeMode === 'deb' ? ('linux' as const) : ('darwin' as const),
      packaged: true,
      appImagePath: fakeMode === 'auto' ? '/tmp/Apiary.AppImage' : undefined,
      macSigned: false,
    }
    : {
      platform: process.platform,
      packaged: app.isPackaged,
      appImagePath: process.env.APPIMAGE,
      macSigned: process.platform === 'darwin' && app.isPackaged && hasDeveloperIdSignature(),
    }
  if (decideCapability(capabilityInput).kind === 'unsupported') return null

  const readUpdateSettings = (): UpdateSettings => {
    const s = loadSettings(settingsFile)
    return {
      automaticChecks: s.updateAutomaticChecks,
      checkIntervalHours: s.updateCheckIntervalHours,
      autoDownload: s.updateAutoDownload,
      allowPrerelease: s.updateAllowPrerelease,
      skippedVersion: s.updateSkippedVersion,
    }
  }

  return new UpdateService({
    currentVersion: app.getVersion(),
    capabilityInput,
    backend: faking
      ? {
        check: async () => ({ version: fake, releaseNotes: 'Fixture release', releaseUrl: `https://example.invalid/${fake}` }),
        downloadForInstall: async (onProgress) => { onProgress(100) },
        install: () => { /* A test must not quit the app. */ },
        downloadInstaller: async (onProgress) => {
          onProgress(100)
          // The extension is what decides the instructions, so the fixture has to get it right.
          return fakeMode === 'deb' ? `/tmp/apiary_${fake}_amd64.deb` : `/tmp/Apiary-${fake}.dmg`
        },
        openInstaller: async () => ({ ok: 'opened' as const }),
      }
      : createUpdateBackend({ repo, platform: process.platform, arch: process.arch }),
    settings: readUpdateSettings,
    saveSettings: (patch) => {
      const current = loadSettings(settingsFile)
      if (patch.skippedVersion !== undefined) {
        saveSettings(settingsFile, { ...current, updateSkippedVersion: patch.skippedVersion })
      }
    },
    onStatus: (status) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send(CHANNELS.updateChanged, status)
      }
    },
  })
}

void app.whenReady().then(async () => {
  setDevDockIcon()
  // Test-only overrides so E2E can run against fixture data.
  const configRoot = process.env.APIARY_CONFIG_ROOT ?? resolveConfigRoot()
  const dbPath = process.env.APIARY_DB_PATH ?? join(app.getPath('userData'), 'apiary.db')
  const fakeLive = process.env.APIARY_FAKE_LIVE
  settingsFile = join(app.getPath('userData'), 'settings.json')
  const sessionLayoutFile = join(app.getPath('userData'), 'session-layout.json')
  sessionLayoutStore = createSessionLayoutStore(sessionLayoutFile)
  layoutFlushCoordinator = createLayoutFlushCoordinator()
  tabRegistry = new TabRegistry()
  const settings = loadSettings(settingsFile)
  // Before anything else that might be worth recording. Off unless the user switched it on.
  configureLogging(settings)
  log.info('app', 'started', {
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    packaged: app.isPackaged,
  })
  // Written straight back, so a migration applied on read is recorded. Without this it would be
  // re-applied on every launch, and a setting the user had since turned off would come back.
  saveSettings(settingsFile, settings)
  // Test-only, like APIARY_GLAB_PATH: substitutes a fake `code` binary for E2E, and an empty
  // string simulates VS Code not being found at all. Undefined (never set outside tests) means
  // run the real detection.
  const codePathOverride = process.env.APIARY_CODE_PATH
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
    glabPath: process.env.APIARY_GLAB_PATH === '' ? undefined : process.env.APIARY_GLAB_PATH,
    vsCodePath,
    onPluginsChanged: () => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send(CHANNELS.pluginsChanged)
      }
    },
    onIndexUpdated: () => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send(CHANNELS.treeChanged)
      }
    },
    detectLive: fakeLive !== undefined && fakeLive !== ''
      ? async () => new Map([[fakeLive, 4242]])
      : undefined,
  })
  updater = createUpdater(settingsFile)
  // Before any window exists: each window asks for its theme synchronously as it loads.
  // `--safe-theme` (or APIARY_SAFE_THEME=1) starts with the original look for this run only.
  const safeTheme = process.argv.includes('--safe-theme') || process.env.APIARY_SAFE_THEME === '1'
  const themes = registerThemeIpc(
    // APIARY_DEFAULT_THEME=original is test-only: the E2E suite is written against the original
    // look, so a fresh profile there starts on it rather than on the default theme.
    new ThemeStore(join(app.getPath('userData'), 'themes.json'), process.env.APIARY_DEFAULT_THEME === 'original' ? null : DEFAULT_THEME_ID),
    safeTheme,
    new ThemeGenerator({ claudeBin: () => service?.claudeBin ?? null }),
  )
  resetTheme = themes.reset
  disposeIpc = registerIpc(
    service, () => mainWindow, configRoot, settingsFile, setAutoImportInterval, updater,
    sessionLayoutStore, layoutFlushCoordinator,
    (tab, at) => createWindow({ detach: tab, at }),
    tabRegistry, windowNumberFor,
  )
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
    createWindow()
  } else {
    // Advanced to the highest recorded window number before restore begins, so a freshly opened
    // window after restore does not collide with a recorded number.
    windowsOpened = Math.max(0, ...records.map((r) => r.number))
    for (const record of records) {
      createWindow({ restore: record }) // never combined with { detach } — restored windows are
      // only ever opened here, never through the drag/tear-off or registerIpc code paths.
    }
  }
  Menu.setApplicationMenu(
    buildMenu(
      () => mainWindow?.webContents.send(CHANNELS.openImportDialog),
      () => {
        void service?.refresh().then(() => mainWindow?.webContents.send(CHANNELS.treeChanged))
      },
      () => mainWindow?.webContents.send(CHANNELS.openSettingsDialog),
      () => { void onNewSessionInFolder() },
      () => createWindow(),
      () => {
        // A manual check should show its answer, whatever the answer is, so the window comes to
        // the front and the banner reports "up to date" and errors as well as updates.
        mainWindow?.show()
        void updater?.check({ manual: true })
      },
      () => mainWindow?.webContents.send(CHANNELS.toggleSidebar),
      () => { resetTheme('menu') },
    ),
  )
  // Started after the window exists, so the first status push has somewhere to land.
  updater?.start()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// A running PTY delivers its output/exit events into the renderer through a native
// (node-pty) background thread. If Electron's own teardown (Node environment cleanup)
// starts while one of those events is still in flight, the callback can throw *after*
// there is no JS context left to catch it — an uncaught native exception that aborts
// the whole process (SIGABRT) rather than a catchable JS error. `before-quit` fires
// synchronously before that teardown begins, so quitting is deferred here just long
// enough for every live PTY to actually exit (`AppService.dispose()`/`PtyManager.killAll()`
// wait on each child's real exit, bounded by a short timeout) before we let quit proceed.
let quitting = false
let shutdownFinished = false
app.on('before-quit', (event) => {
  // The one quit that is allowed through: the one this handler issues itself once teardown is
  // done. Everything else is deferred, including a *second* request arriving while the first is
  // still running — a Cmd+Q on top of a window-close quit, or a test harness calling `app.quit()`
  // twice. Letting that second one through (as simply returning early used to) tears the process
  // down in the middle of the teardown it asked for, losing the layout flush and leaving the PTYs
  // to be reaped by Electron's own cleanup — the native abort the deferral exists to avoid.
  if (shutdownFinished) return
  event.preventDefault()
  if (quitting) return
  quitting = true
  void (async () => {
    try {
      await shutdown()
    } finally {
      // `preventDefault()` above has already stopped this quit, so anything that throws on the way
      // through must not be allowed to skip `app.quit()` — the app would then be unquittable, with
      // every later Cmd+Q deferred forever. Losing some saved state on a bad shutdown is
      // survivable; an app that cannot be quit is not.
      shutdownFinished = true
      app.quit()
    }
  })()
})

async function shutdown(): Promise<void> {
  try {
    // Before dispose(), so a pending rescan can never fire against a closed store.
    setAutoImportInterval(null)
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
