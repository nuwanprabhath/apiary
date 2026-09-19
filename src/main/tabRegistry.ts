import type { BrowserWindow } from 'electron'
import { CHANNELS } from '@shared/api'

/** A tab a window currently has open, as it reports itself — see App.tsx's report effect. */
export interface OpenTab {
  windowNumber: number
  key: string
  view: 'transcript' | 'terminal'
  /** The pty this tab's process runs under, when it has one (a fresh new-session pty before its
   *  real session id exists, or the session id itself once resolved). Null for a transcript-only
   *  tab that has never been run as a terminal. */
  ptyId: string | null
}

/**
 * What tabs are open, across every window, for the Active section.
 *
 * Deliberately dumb: it holds exactly what each window last reported and nothing derived from it
 * — status classification reads `PtyManager` fresh at render time in ipc.ts, because activity
 * changes constantly and this registry should not become a second place that state can go stale.
 */
export class TabRegistry {
  private byWindow = new Map<number, OpenTab[]>()
  private handlers: (() => void)[] = []

  onChange(handler: () => void): void { this.handlers.push(handler) }
  private notify(): void { for (const h of this.handlers) h() }

  /** Replaces everything window `windowNumber` has open. A tab that existed before and is absent
   *  from `tabs` is gone — closing a tab is reported by simply not including it next time, the
   *  same way a window's full set is reported rather than diffed. */
  report(windowNumber: number, tabs: OpenTab[]): void {
    this.byWindow.set(windowNumber, tabs)
    this.notify()
  }

  unregisterWindow(windowNumber: number): void {
    if (!this.byWindow.delete(windowNumber)) return
    this.notify()
  }

  list(): OpenTab[] {
    return [...this.byWindow.values()].flat()
  }
}

/**
 * The window number a `BrowserWindow` was created with, read back from its own `?w=` query — the
 * same convention `stateKey()` reads in the renderer (see `uiState.ts`) and `createWindow` writes
 * in `main/index.ts`. Reading it from the URL, rather than needing a second id->number map handed
 * in here, keeps this file free of anything but the one piece of Electron it actually needs.
 */
function windowNumberOf(win: BrowserWindow): number | null {
  try {
    const w = Number(new URL(win.webContents.getURL()).searchParams.get('w'))
    return Number.isFinite(w) && w > 0 ? w : null
  } catch {
    return null
  }
}

/**
 * Raises the window showing `windowNumber` and tells it to select `key` — the far side of a click
 * on an Active row in another window's sidebar.
 *
 * A free function, not a method on `TabRegistry`, because it needs `BrowserWindow`, and that has
 * to stay out of anything meant to be unit-testable without Electron (see the class above).
 */
export function focusTab(windows: BrowserWindow[], windowNumber: number, key: string): void {
  const target = windows.find((w) => !w.isDestroyed() && windowNumberOf(w) === windowNumber)
  if (target === undefined) return
  if (target.isMinimized()) target.restore()
  target.focus()
  target.webContents.send(CHANNELS.selectTab, key)
}
