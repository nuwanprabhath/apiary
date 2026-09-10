import { app, BrowserWindow, Menu, dialog, screen, session } from 'electron'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AppService } from './appService'
import { registerIpc } from './ipc'
import { resolveConfigRoot } from './config'
import { buildMenu } from './menu'
import { CHANNELS } from '@shared/api'
import { loadSettings, saveSettings } from './settings'
import { boundsAreOnScreen } from './windowBounds'

const dirname = fileURLToPath(new URL('.', import.meta.url))

let service: AppService | null = null
let disposeIpc: (() => void) | null = null
let mainWindow: BrowserWindow | null = null
let settingsFile = ''
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

function createWindow(): void {
  const saved = loadSettings(settingsFile).windowBounds
  const bounds =
    saved && boundsAreOnScreen(saved, screen.getAllDisplays().map((d) => d.workArea))
      ? saved
      : { width: 1400, height: 900 }

  const win = new BrowserWindow({
    ...bounds,
    minWidth: 900,
    minHeight: 600,
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
  mainWindow = win
  win.on('closed', () => { mainWindow = null })

  // Deliberately never shown in headless mode: `show: false` above is the initial state, and this
  // is the line that would undo it.
  if (!headless) win.on('ready-to-show', () => win.show())

  const persistBounds = (): void => {
    const current = loadSettings(settingsFile)
    saveSettings(settingsFile, { ...current, windowBounds: win.getNormalBounds() })
  }
  win.on('resized', persistBounds)
  win.on('moved', persistBounds)

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(dirname, '../renderer/index.html'))
  }
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

void app.whenReady().then(async () => {
  setDevDockIcon()
  // Test-only overrides so E2E can run against fixture data.
  const configRoot = process.env.APIARY_CONFIG_ROOT ?? resolveConfigRoot()
  const dbPath = process.env.APIARY_DB_PATH ?? join(app.getPath('userData'), 'apiary.db')
  const fakeLive = process.env.APIARY_FAKE_LIVE
  settingsFile = join(app.getPath('userData'), 'settings.json')
  const settings = loadSettings(settingsFile)
  service = new AppService({
    configRoot,
    dbPath,
    claudeBin: settings.claudeBin ?? undefined,
    autoImportAll: settings.autoImportAll,
    detectLive: fakeLive !== undefined && fakeLive !== ''
      ? async () => new Map([[fakeLive, 4242]])
      : undefined,
  })
  disposeIpc = registerIpc(service, () => mainWindow, configRoot, settingsFile, setAutoImportInterval)
  await service.refresh()
  // The first refresh runs before the window exists, so nothing is listening for `treeChanged`
  // yet — importing here, before the window is created, is what makes everything already be in
  // the tree by the time the sidebar first asks for it.
  if (settings.autoImportAll) {
    await service.importAllDiscovered()
  }
  setAutoImportInterval(settings.autoImportIntervalMinutes)
  createWindow()
  Menu.setApplicationMenu(
    buildMenu(
      () => mainWindow?.webContents.send(CHANNELS.openImportDialog),
      () => {
        void service?.refresh().then(() => mainWindow?.webContents.send(CHANNELS.treeChanged))
      },
      () => mainWindow?.webContents.send(CHANNELS.openSettingsDialog),
      () => { void onNewSessionInFolder() },
    ),
  )
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
app.on('before-quit', (event) => {
  if (quitting) return
  event.preventDefault()
  quitting = true
  void (async () => {
    // Before dispose(), so a pending rescan can never fire against a closed store.
    setAutoImportInterval(null)
    // The renderer keeps its UI state (selected session, sidebar width, pins) in localStorage, and
    // Chromium commits that to disk on a batching timer rather than on write. Quitting shortly
    // after a change could therefore drop it — you would come back to the app having forgotten
    // which session you had open. This forces the pending write out before shutdown continues.
    session.defaultSession.flushStorageData()
    disposeIpc?.()
    await service?.dispose()
    app.quit()
  })()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
