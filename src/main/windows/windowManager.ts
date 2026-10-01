import { isWindowChrome, type WindowChrome } from '@shared/domain/windowChrome'
import { BrowserWindow, screen, shell } from 'electron'
import { join } from 'node:path'
import { boundsAreOnScreen } from './windowBounds'
import { guardNavigation } from './navigationGuard'
import { log } from '../log/logger'
import { fireAndForget } from '../log/fireAndForget'
import type { SettingsService } from '../settings/settingsService'
import type { SessionLayoutStore, WindowLayoutRecord } from './sessionLayoutStore'
import type { TabRegistry } from './tabRegistry'
import type { TabTransfer } from '@shared/types'

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

export interface WindowManagerDeps {
  settingsService: SettingsService
  sessionLayoutStore: SessionLayoutStore | null
  tabRegistry: TabRegistry | null
  /** Keeps every window off-screen, for a test run that must not steal focus (see `index.ts`). */
  headless: boolean
  /** The directory `index.ts` itself resolves from (`fileURLToPath(new URL('.', import.meta.url))`),
   *  for locating the preload script and the packaged icon/renderer HTML the same way it always did. */
  dirname: string
  /** The Vite dev server origin, when running unbuilt — `undefined` in a packaged build. */
  rendererUrl: string | undefined
  /** Whether the app has started quitting — read by the `closed` handler; see its own comment. */
  isQuitting: () => boolean
  /** `APIARY_WINDOW_CHROME`, test-only: overrides which title bar windows get. */
  chromeOverride?: string
  /** How long a closed window's layout record outlives it while other windows stay open — see
   *  `CLOSE_GRACE_MS`. Injectable so tests need not wait out the real one. */
  closeGraceMs?: number
}

/**
 * How long a window closed while others are still open keeps its saved layout. Ubuntu's dock
 * "Quit" (and closing each window's X in turn) closes the windows one at a time with no app-level
 * quit first, so every window but the last used to count as "closed by the user" and lose its
 * record — two windows quit that way came back as one. Windows that all close within this long of
 * each other are a quit, and all come back; one closed while the app carries on is dropped once
 * it has passed.
 */
export const CLOSE_GRACE_MS = 3000

/**
 * Window creation, numbering, focus tracking and the one window's persisted bounds (MAIN-15 step
 * 3) — pure move out of `index.ts`'s `createWindow`/`mainWindow`/`windowsOpened`/
 * `windowNumberByWebContentsId`. Behaviour, ordering and every comment explaining a past bug are
 * unchanged; only the mutable state they described moved from module-level variables to fields on
 * this class, constructed once in `index.ts`'s `start()`.
 */
export class WindowManager {
  private readonly deps: WindowManagerDeps
  /**
   * How many windows have ever been opened this run, which is what gives each one its identity.
   *
   * Windows share one main process — and therefore one set of sessions, terminals and settings —
   * but not one layout: which tabs and columns a window has open is its own. The renderer keys its
   * persisted layout on this number (see uiState.ts), so a second window is a second workspace
   * over the same sessions rather than a duplicate that fights the first over the same stored
   * state. Numbers are not reused, so closing window 2 and opening another gives a fresh workspace
   * rather than inheriting a dead one's arrangement.
   */
  private windowsOpened = 0
  private mainWindow: BrowserWindow | null = null
  /** `webContents.id` -> the window number it was created with, so a `reportTabs` call (which only
   *  carries the sender's webContents) can be filed under the same number `SessionLayoutStore` and
   *  the `?w=` URL already use for that window. Populated and cleared right alongside the window
   *  itself in `create()`, the same lifecycle `sessionLayoutStore`'s per-window bookkeeping follows. */
  private readonly windowNumberByWebContentsId = new Map<number, number>()
  /** Closed windows whose layout record is waiting out `CLOSE_GRACE_MS` before it is removed. */
  private readonly pendingRemovals = new Map<number, NodeJS.Timeout>()

  constructor(deps: WindowManagerDeps) {
    this.deps = deps
  }

  /** The window the menu and native dialogs act on — whichever one is currently in front. */
  /** Every window has closed: those still in their grace period went with the rest, as a quit. */
  private cancelPendingRemovals(): void {
    for (const timer of this.pendingRemovals.values()) clearTimeout(timer)
    this.pendingRemovals.clear()
  }

  front(): BrowserWindow | null {
    return this.mainWindow
  }

  windowNumberFor(webContentsId: number): number | null {
    return this.windowNumberByWebContentsId.get(webContentsId) ?? null
  }

  /**
   * Advances the "windows opened" counter to at least `n`, so a freshly opened window after a
   * multi-window restore does not collide with a recorded number. Called once, before restoring.
   */
  advanceOpenedTo(n: number): void {
    this.windowsOpened = Math.max(this.windowsOpened, n)
  }

  create(opts: NewWindowOptions = {}): number {
    const { settingsService, sessionLayoutStore, tabRegistry, headless, dirname, rendererUrl, isQuitting } = this.deps
    this.windowsOpened += 1
    const windowNumber = opts.restore?.number ?? this.windowsOpened
    const isFirst = windowNumber === 1

    const detached = opts.detach !== undefined

    const saved = settingsService.get().windowBounds
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
    const bounds = restoreBounds ?? (isFirst && !detached
        ? effectiveBounds
        : {
          // A detached window has no sidebar, so it does not need the width for one — and a window
          // torn off by dragging should appear under the pointer that tore it off, not cascaded
          // from wherever the last window happened to be.
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
      title: 'Apiary',
      // A *packaged* macOS app takes its window/dock icon from the .app bundle (see
      // `mac.icon` in electron-builder.yml) and ignores this option entirely — but `npm start`
      // runs the bare Electron binary with no bundle at all, so without `setDevDockIcon()`
      // (index.ts) the Dock falls back to Electron's own default icon. Linux and Windows always
      // read the icon from the running process, packaged or not, so they need this option either
      // way. `build/icon.png` is listed in electron-builder.yml's `files`, so this same
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
    log.info('window', 'created', { number: windowNumber, detached, at: opts.at !== undefined, chrome })
    // The menu is still the application menu — its accelerators keep working — but on a custom
    // title bar it is drawn by the renderer (see TitleBar.tsx), not as a GTK/Win32 bar above it.
    if (chrome === 'custom') win.setMenuBarVisibility(false)
    guardNavigation(win.webContents, (url) => shell.openExternal(url))
    // Captured now, not read back off `win.webContents` in the `closed` handler below: by the time
    // `closed` fires the window (and its webContents) has already been destroyed, and touching
    // `win.webContents` at that point throws `Object has been destroyed` — uncaught, since `closed`
    // is an Electron event emitter callback, which took the whole main process down with a native
    // error dialog every time a window closed.
    const webContentsId = win.webContents.id
    this.windowNumberByWebContentsId.set(webContentsId, windowNumber)
    this.mainWindow = win
    // The menu and native dialogs act on whichever window is in front, so this follows focus rather
    // than staying pinned to the first window opened.
    win.on('focus', () => { this.mainWindow = win })

    // Only the first window's geometry is remembered in settings.json: with several open there is
    // no single "the window" to restore, and letting each one write would mean the last window
    // moved silently decides where the app opens next time. The session-layout store is different —
    // it tracks every window by number, so every window's bounds go there regardless.
    // Debounced (MAIN-10): Electron documents `moved` on macOS as an alias of `move`, which can
    // fire continuously through a drag — each call was a synchronous settings-file read (even for
    // every window but the first, which never writes) followed by a write for the first window.
    // A trailing 300ms debounce turns a drag's whole burst into one read and, for the first window,
    // one write once the drag actually settles.
    let boundsTimer: NodeJS.Timeout | null = null
    if (!detached) {
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
      // A pending debounced write must not fire after the window (and its `getNormalBounds()`) is
      // gone.
      if (boundsTimer) { clearTimeout(boundsTimer); boundsTimer = null }
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
      //
      // Nor is it removed at once when other windows remain: see `CLOSE_GRACE_MS`. If the rest
      // close before the grace runs out, this was one step of a quit and every pending record stays.
      if (BrowserWindow.getAllWindows().length === 0) {
        this.cancelPendingRemovals()
      } else if (!isQuitting()) {
        this.pendingRemovals.set(windowNumber, setTimeout(() => {
          this.pendingRemovals.delete(windowNumber)
          if (isQuitting() || BrowserWindow.getAllWindows().length === 0) return
          sessionLayoutStore?.removeWindow(windowNumber)
        }, this.deps.closeGraceMs ?? CLOSE_GRACE_MS))
      }
      tabRegistry?.unregisterWindow(windowNumber)
      this.windowNumberByWebContentsId.delete(webContentsId)
      if (this.mainWindow === win) this.mainWindow = BrowserWindow.getAllWindows()[0] ?? null
    })

    // Deliberately never shown in headless mode: `show: false` above is the initial state, and this
    // is the line that would undo it.
    if (!headless) win.on('ready-to-show', () => win.show())

    // The window's number reaches the renderer through the URL rather than the preload bridge: it is
    // needed before anything else to pick which stored layout to load, and a query string is
    // available synchronously at first render.
    const query: Record<string, string> = { w: String(windowNumber), chrome }
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
      // the `records` filter in `index.ts`'s `start()`), so the renderer has nothing to do with it.
      query.restore = JSON.stringify({ ...opts.restore, bounds: undefined, hasLayout: undefined })
    }
    if (rendererUrl) {
      const url = new URL(rendererUrl)
      for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
      fireAndForget(win.loadURL(url.toString()), 'window')
    } else {
      fireAndForget(win.loadFile(join(dirname, '../renderer/index.html'), { query }), 'window')
    }
    return windowNumber
  }
}

/** Which title bar a new window gets — see `WindowChrome`. */
export function windowChromeFor(platform: NodeJS.Platform, systemTitleBar: boolean): WindowChrome {
  if (systemTitleBar) return 'system'
  return platform === 'darwin' ? 'mac' : 'custom'
}

/** Title-bar height the renderer's bar is drawn at; the overlay's controls are sized to match. */
export const TITLE_BAR_HEIGHT = 32

function chromeOptions(chrome: WindowChrome): Electron.BrowserWindowConstructorOptions {
  if (chrome === 'mac') return { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 12, y: 10 } }
  if (chrome === 'custom') {
    // Neutral until the renderer reports its theme's colours (setTitleBarColors) — a fraction of
    // a second after the first paint.
    return { titleBarStyle: 'hidden', titleBarOverlay: { color: '#1b1c1e', symbolColor: '#e6e6e6', height: TITLE_BAR_HEIGHT } }
  }
  return {}
}
