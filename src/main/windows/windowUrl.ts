import type { BrowserWindow } from 'electron'

/** The query a window's page was opened with: its number (`w=`), a remote window's host (`remote=`). */
export function windowQuery(win: BrowserWindow): URLSearchParams {
  try { return new URL(win.webContents.getURL()).searchParams } catch { return new URLSearchParams() }
}

/** A window's number, as its URL carries it (`w=`); null for a page that has none (a pet's window). */
export function windowNumberInUrl(win: BrowserWindow): number | null {
  const w = Number(windowQuery(win).get('w'))
  return Number.isFinite(w) && w > 0 ? w : null
}
