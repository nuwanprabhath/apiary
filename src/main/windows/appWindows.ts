import { app, type BrowserWindow } from 'electron'
import { TITLE_SUFFIX, type AppWindowInfo } from '@shared/domain/appWindows'
import { windowQuery } from './windowUrl'

/** The width a preview is shrunk to: a status-bar tile, about the size of a taskbar thumbnail. */
const PREVIEW_WIDTH = 360

interface WindowsDeps {
  /** Every window, in the order they opened. */
  all: () => BrowserWindow[]
  /** The number a window's page was given, or null for one that has none (a pet's window). */
  numberOf: (win: BrowserWindow) => number | null
}


/**
 * The status bar's window buttons, read from the windows themselves: a title, set by each page from
 * its active tab (`useWindowTitle`), whether it has focus, and whether it is minimised. In window
 * order, which `getAllWindows()` is not (it lists the newest first).
 */
export function listAppWindows(deps: WindowsDeps): AppWindowInfo[] {
  return deps.all().flatMap((win): AppWindowInfo[] => {
    if (win.isDestroyed()) return []
    const number = deps.numberOf(win)
    if (number === null) return []
    const raw = win.getTitle()
    return [{
      number,
      title: raw.endsWith(TITLE_SUFFIX) ? raw.slice(0, -TITLE_SUFFIX.length) : raw,
      focused: win.isFocused(),
      minimized: win.isMinimized(),
      remoteHost: windowQuery(win).get('remote'),
    }]
  }).sort((a, b) => a.number - b.number)
}

function find(deps: WindowsDeps, number: number): BrowserWindow | undefined {
  return deps.all().find((w) => !w.isDestroyed() && deps.numberOf(w) === number)
}

/**
 * Brings a window to the front, from under whatever covers it, restoring it when minimised. A window
 * that was never shown (a headless run's) stays hidden: raising it would put it on someone's screen.
 */
export function raiseAppWindow(deps: WindowsDeps, number: number): boolean {
  const win = find(deps, number)
  if (win === undefined) return false
  if (win.isMinimized()) win.restore()
  else if (!win.isVisible()) return false
  win.focus()
  return true
}

/** A small picture of what a window shows, as a data URL; null for one there is no picture of (minimised, or gone). */
export async function previewAppWindow(deps: WindowsDeps, number: number): Promise<string | null> {
  const win = find(deps, number)
  if (win === undefined || win.isMinimized()) return null
  const image = await win.webContents.capturePage()
  if (image.isEmpty()) return null
  return image.resize({ width: PREVIEW_WIDTH, quality: 'good' }).toDataURL()
}

/**
 * Calls `onChange` when a window opens, closes, is retitled, gains or loses focus, or is minimised
 * or restored, coalesced into one call per burst (focus moving is a blur and a focus). `changed`
 * says so from outside (a window raised); `stop` ends it.
 */
export function watchAppWindows(onChange: () => void, delayMs = 50): { changed: () => void; stop: () => void } {
  let timer: NodeJS.Timeout | null = null
  const changed = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => { timer = null; onChange() }, delayMs)
  }
  const watch = (_e: unknown, win: BrowserWindow): void => {
    win.on('page-title-updated', changed)
    win.on('focus', changed)
    win.on('blur', changed)
    win.on('minimize', changed)
    win.on('restore', changed)
    win.on('show', changed)
    win.on('hide', changed)
    win.on('closed', changed)
    changed()
  }
  app.on('browser-window-created', watch)
  return {
    changed,
    stop: () => {
      app.off('browser-window-created', watch)
      if (timer !== null) clearTimeout(timer)
    },
  }
}
