import { isRecord } from '@shared/guards'
import { isWindowChrome, type WindowChrome } from '@shared/domain/windowChrome'
import { BrowserWindow, screen, shell } from 'electron'
import { join } from 'node:path'
import { boundsAreOnScreen, type WindowBounds } from './windowBounds'
import { minimumWidth, widenedBounds } from './windowWidth'
import { guardNavigation } from './navigationGuard'
import { watchContextMenu } from './contextMenu'
import { log } from '../log/logger'
import { closeGraceMs } from './closeGrace'
import { fireAndForget } from '../log/fireAndForget'
import type { SessionLayoutStore, WindowLayoutRecord } from './sessionLayoutStore'
import type { TabRegistry } from './tabRegistry'
import type { TabTransfer } from '@shared/types'

/**
 * A window that shows one session and nothing else (a tab dragged out, or `Move into New Window`).
 * The key travels in the URL because the renderer needs it at first render, before an IPC round
 * trip could answer.
 */
export interface NewWindowOptions {
  /** The tab this window opens on its own, with no sidebar. */
  detach?: TabTransfer
  /** Where to put it — the pointer, when the window was made by dragging a tab out of another. */
  at?: { x: number; y: number }
  /** A window being recreated from the previous run's SessionLayoutStore record. */
  restore?: WindowLayoutRecord
  /** A window showing a work machine (`remote/remoteClientService.ts`): titled with its name, given a fresh number here, and never stored in this machine's session layout. */
  remote?: { host: string; /** The work machine's layout record for the window being copied (`RemoteWindowLayout.layout`), if it has one. */ layout?: unknown }
}

/** Its page has been asked to load but has not run yet. */
export interface OpenedWindow {
  number: number
  webContentsId: number
  onClosed(listener: () => void): void
}

/** The settings a window reads, and the one it writes back (the first window's geometry). */
interface WindowSettings {
  get(): { windowBounds: WindowBounds | null; systemTitleBar: boolean }
  patch(change: { windowBounds: WindowBounds }): unknown
}

export interface WindowManagerDeps {
  settingsService: WindowSettings
  sessionLayoutStore: SessionLayoutStore | null
  tabRegistry: TabRegistry | null
  /** Keeps every window off-screen, for a test run that must not steal focus (see `index.ts`). */
  headless: boolean
  /** The directory `index.ts` resolves from, for the preload script, icon and renderer HTML. */
  dirname: string
  /** The Vite dev server origin when running unbuilt; `undefined` when packaged. */
  rendererUrl: string | undefined
  isQuitting: () => boolean
  /** `APIARY_WINDOW_CHROME`, test-only: overrides which title bar windows get. */
  chromeOverride?: string
  /** `APIARY_RENDERER_SEAMS`, test-only (undefined when packaged): reaches the renderer as `?seams=`. */
  rendererSeams?: string
  /** Overrides `closeGraceMs`, so tests need not wait it out. */
  closeGraceMs?: number
}

/** Window creation, numbering, focus tracking and the first window's persisted bounds. */
export class WindowManager {
  private readonly deps: WindowManagerDeps
  /**
   * Windows opened this run; each window's identity. The renderer keys its persisted layout on the
   * number (uiState.ts), so a second window is its own workspace. Numbers are not reused: a new
   * window never inherits a closed one's arrangement.
   */
  private windowsOpened = 0
  private mainWindow: BrowserWindow | null = null
  /** `webContents.id` -> window number, so a call carrying only the sender's webContents (`reportTabs`) can be filed under it. */
  private readonly windowNumberByWebContentsId = new Map<number, { number: number; remote: boolean; baseMinWidth: number }>()
  /** Closed windows whose layout record is waiting out `closeGraceMs` before it is removed. */
  private readonly pendingRemovals = new Map<number, NodeJS.Timeout>()
  /** Told when a local window closes, and whether that is the app quitting (the pets' owners move). */
  private readonly closeListeners: ((number: number, quitting: boolean) => void)[] = []

  constructor(deps: WindowManagerDeps) {
    this.deps = deps
  }

  /** Every window has closed: those still in their grace period went with the rest, as a quit. */
  private cancelPendingRemovals(): void {
    for (const timer of this.pendingRemovals.values()) clearTimeout(timer)
    this.pendingRemovals.clear()
  }

  /** A closed window's record: kept when it was the last one, otherwise dropped after the grace. */
  private keepOrForget(windowNumber: number, remote: boolean): void {
    const { isQuitting, sessionLayoutStore } = this.deps
    const remaining = BrowserWindow.getAllWindows().length
    log.info('window', 'closed', { number: windowNumber, remaining, quitting: isQuitting() })
    if (remaining === 0) {
      this.cancelPendingRemovals()
    } else if (!isQuitting() && !remote) {
      this.pendingRemovals.set(windowNumber, setTimeout(() => {
        this.pendingRemovals.delete(windowNumber)
        if (isQuitting() || BrowserWindow.getAllWindows().length === 0) return
        sessionLayoutStore?.removeWindow(windowNumber)
        log.info('window', 'forgotten: closed while others stayed open', { number: windowNumber })
      }, this.deps.closeGraceMs ?? closeGraceMs(process.platform)))
    }
  }

  /** The window the menu and native dialogs act on: whichever is in front. */
  front(): BrowserWindow | null {
    return this.mainWindow
  }

  windowNumberFor(webContentsId: number): number | null {
    return this.windowNumberByWebContentsId.get(webContentsId)?.number ?? null
  }

  /**
   * The window's panes need `width` to fit at their minimum (`requireWindowWidth`): its minimum
   * width becomes that (never below its kind's own), and a narrower window is widened to it.
   */
  requireWidth(win: BrowserWindow, width: number): void {
    const record = this.windowNumberByWebContentsId.get(win.webContents.id)
    if (record === undefined || win.isDestroyed()) return
    const min = minimumWidth(record.baseMinWidth, width)
    const [, minHeight] = win.getMinimumSize()
    win.setMinimumSize(min, minHeight)
    if (win.isMaximized() || win.isFullScreen()) return
    const bounds = win.getBounds()
    // A headless run keeps its windows off-screen: widen in place rather than onto the screen.
    const area = this.deps.headless ? { ...bounds, width: Math.max(bounds.width, min) } : screen.getDisplayMatching(bounds).workArea
    const next = widenedBounds(bounds, area, min)
    if (next !== null) win.setBounds(next)
  }

  /** Whether the window shows another machine (`NewWindowOptions.remote`). */
  isRemote(webContentsId: number): boolean {
    return this.windowNumberByWebContentsId.get(webContentsId)?.remote === true
  }

  /** `listener(number, quitting)` after a local window closes; `quitting` when the app is quitting or no window is left. */
  onWindowClosed(listener: (number: number, quitting: boolean) => void): void {
    this.closeListeners.push(listener)
  }

  /** Raises the counter to at least `n`, so a new window after a restore does not collide with a recorded number. */
  advanceOpenedTo(n: number): void {
    this.windowsOpened = Math.max(this.windowsOpened, n)
  }

  create(opts: NewWindowOptions = {}): number {
    return this.open(opts).number
  }

  /** `create`, also returning the webContents, so the caller can bind the window before the page's first call. */
  open(opts: NewWindowOptions = {}): OpenedWindow {
    const { settingsService, sessionLayoutStore, tabRegistry, headless, dirname, rendererUrl, isQuitting } = this.deps
    this.windowsOpened += 1
    const remote = opts.remote
    // A remote window's layout comes from the work machine, whose window numbers mean nothing here.
    const windowNumber = remote === undefined ? opts.restore?.number ?? this.windowsOpened : this.windowsOpened
    const isFirst = windowNumber === 1

    const detached = opts.detach !== undefined

    const saved = settingsService.get().windowBounds
    const restored =
      saved && boundsAreOnScreen(saved, screen.getAllDisplays().map((d) => d.workArea))
        ? saved
        : { width: 1400, height: 900 }
    // A restored window's own bounds are more specific than the last-known single position.
    const restoreBounds = opts.restore !== undefined
      && boundsAreOnScreen(opts.restore.bounds, screen.getAllDisplays().map((d) => d.workArea))
      ? opts.restore.bounds
      : null
    // Only the first window restores its saved position; a second exactly on top of it looks like
    // nothing happened, so it cascades.
    const offset = isFirst ? 0 : ((windowNumber - 1) % 5) * 30
    const effectiveBounds: { x?: number; y?: number; width: number; height: number } = restoreBounds ?? restored
    const effectivePos = typeof effectiveBounds.x === 'number' && typeof effectiveBounds.y === 'number'
      ? { x: effectiveBounds.x, y: effectiveBounds.y }
      : null
    const bounds = restoreBounds ?? (isFirst && !detached
        ? effectiveBounds
        : {
          // A detached window has no sidebar, and one torn off by dragging appears under the pointer.
          width: detached ? Math.min(effectiveBounds.width, 1000) : effectiveBounds.width,
          height: effectiveBounds.height,
          ...(opts.at !== undefined
            ? { x: Math.round(opts.at.x - 120), y: Math.round(opts.at.y - 20) }
            : effectivePos !== null
              ? { x: effectivePos.x + offset, y: effectivePos.y + offset }
              : {}),
        })

    const override = this.deps.chromeOverride
    const chrome = isWindowChrome(override)
      ? override
      : windowChromeFor(process.platform, this.deps.settingsService.get().systemTitleBar)
    const win = new BrowserWindow({
      ...bounds,
      ...chromeOptions(chrome),
      minWidth: detached ? 520 : 900,
      minHeight: 400,
      show: false,
      title: remote === undefined ? 'Apiary' : `${remote.host} — Apiary`,
      // A packaged macOS app takes its icon from the .app bundle (`mac.icon` in
      // electron-builder.yml) and ignores this option; `npm start` has no bundle (`setDevDockIcon()`
      // in index.ts). Linux and Windows always read it from here. `build/icon.png` is in
      // electron-builder.yml's `files`, so the path resolves in dev and inside app.asar.
      ...(process.platform === 'darwin'
        ? {}
        : { icon: join(dirname, '../../build/icon.png') }),
      webPreferences: {
        preload: join(dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // Chromium treats a never-shown window as background: it throttles timers and stops
        // requestAnimationFrame, which the terminal fit and transcript scroll rely on.
        ...(headless ? { backgroundThrottling: false } : {}),
      },
    })
    log.info('window', 'created', { number: windowNumber, detached, at: opts.at !== undefined, chrome })
    // On a custom title bar the menu is drawn by the renderer (TitleBar.tsx); accelerators still work.
    if (chrome === 'custom') win.setMenuBarVisibility(false)
    guardNavigation(win.webContents, (url) => shell.openExternal(url))
    watchContextMenu(win.webContents)
    // Captured now: by the time `closed` fires the webContents is destroyed, and touching it throws
    // `Object has been destroyed`, uncaught in an emitter callback.
    const webContentsId = win.webContents.id
    this.windowNumberByWebContentsId.set(webContentsId, { number: windowNumber, remote: remote !== undefined, baseMinWidth: detached ? 520 : 900 })
    this.mainWindow = win
    win.on('focus', () => { this.mainWindow = win })

    // Only the first window's geometry goes to settings.json (with several open, the last one moved
    // would silently decide); the session-layout store gets every window's. Debounced because
    // Electron documents `moved` on macOS as an alias of `move`, which fires through a drag.
    let boundsTimer: NodeJS.Timeout | null = null
    if (!detached && remote === undefined) {
      const persistBounds = (): void => {
        if (boundsTimer) clearTimeout(boundsTimer)
        boundsTimer = setTimeout(() => {
          boundsTimer = null
          const normal = win.getNormalBounds()
          if (isFirst) settingsService.patch({ windowBounds: normal })
          sessionLayoutStore?.reportBounds(windowNumber, normal)
        }, 300)
      }
      win.on('resized', persistBounds)
      win.on('moved', persistBounds)
    }
    win.on('closed', () => {
      if (boundsTimer) { clearTimeout(boundsTimer); boundsTimer = null }
      // On Linux and Windows quitting is the last window's X button: `closed` -> `window-all-closed`
      // -> `app.quit()` -> `before-quit`. Nothing has decided to quit when `closed` fires and
      // `before-quit` runs after any deletion, so the last window out leaves its record behind
      // (otherwise every quit but Cmd+Q writes an empty layout). With other windows remaining the
      // record goes after `closeGraceMs`, in case this was one step of a quit.
      this.keepOrForget(windowNumber, remote !== undefined)
      tabRegistry?.unregisterWindow(windowNumber)
      this.windowNumberByWebContentsId.delete(webContentsId)
      if (remote === undefined) {
        const quitting = isQuitting() || BrowserWindow.getAllWindows().length === 0
        for (const listener of this.closeListeners) listener(windowNumber, quitting)
      }
      if (this.mainWindow === win) this.mainWindow = BrowserWindow.getAllWindows()[0] ?? null
    })

    if (!headless) win.on('ready-to-show', () => win.show())

    // The number travels in the URL: it picks the stored layout and is needed synchronously at first render.
    const query: Record<string, string> = { w: String(windowNumber), chrome }
    if (opts.detach !== undefined) {
      query.detach = opts.detach.key
      query.transfer = JSON.stringify(opts.detach)
    }
    if (opts.restore !== undefined) {
      // The renderer never needs `bounds` (window geometry) or `hasLayout` (checked by the
      // `records` filter in `index.ts`'s `start()`).
      query.restore = JSON.stringify({ ...opts.restore, bounds: undefined, hasLayout: undefined })
    }
    if (remote !== undefined) {
      query.remote = remote.host
      if (isRecord(remote.layout)) query.restore = JSON.stringify({ ...remote.layout, number: windowNumber, bounds: undefined, hasLayout: undefined })
    }
    if (this.deps.rendererSeams !== undefined) query.seams = this.deps.rendererSeams
    if (rendererUrl) {
      const url = new URL(rendererUrl)
      for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
      fireAndForget(win.loadURL(url.toString()), 'window')
    } else {
      fireAndForget(win.loadFile(join(dirname, '../renderer/index.html'), { query }), 'window')
    }
    return { number: windowNumber, webContentsId, onClosed: (listener) => { win.once('closed', listener) } }
  }
}

function windowChromeFor(platform: NodeJS.Platform, systemTitleBar: boolean): WindowChrome {
  if (systemTitleBar) return 'system'
  return platform === 'darwin' ? 'mac' : 'custom'
}

/** Title-bar height the renderer's bar is drawn at; the overlay's controls are sized to match. */
export const TITLE_BAR_HEIGHT = 32

function chromeOptions(chrome: WindowChrome): Electron.BrowserWindowConstructorOptions {
  if (chrome === 'mac') return { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 12, y: 10 } }
  if (chrome === 'custom') {
    // Neutral until the renderer reports its theme's colours (setTitleBarColors).
    return { titleBarStyle: 'hidden', titleBarOverlay: { color: '#1b1c1e', symbolColor: '#e6e6e6', height: TITLE_BAR_HEIGHT } }
  }
  return {}
}
