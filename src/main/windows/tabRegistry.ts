import type { BrowserWindow } from 'electron'
import { IPC } from '@shared/api'
import type { OpenTab } from '@shared/domain/tabs'
import { sendEvent } from './sendEvent'

// Defined in shared/domain/tabs.ts: the wire type `ApiaryApi.reportTabs` takes is the same shape
// minus `windowNumber`, and a mirrored copy drifts.
export type { OpenTab } from '@shared/domain/tabs'

/**
 * What tabs are open, across every window, for the Active section.
 *
 * Deliberately dumb: it holds exactly what each window last reported. Each tab's activity is worked
 * out when it is asked for, by `ActiveTabsService`, so nothing derived here can go stale.
 */
export class TabRegistry {
  private byWindow = new Map<number, OpenTab[]>()
  private handlers: (() => void)[] = []

  onChange(handler: () => void): void { this.handlers.push(handler) }
  private notify(): void { for (const h of this.handlers) h() }

  /** Replaces everything window `windowNumber` has open: a tab absent from `tabs` is closed. */
  report(windowNumber: number, tabs: OpenTab[]): void {
    this.byWindow.set(windowNumber, tabs)
    this.notify()
  }

  /**
   * Moves one tab to `windowNumber` now, ahead of that window's own report — see `handOver` in
   * ipc.ts. The window's next report replaces all of this with what it really has open.
   */
  handOver(windowNumber: number, tab: OpenTab): void {
    for (const [n, tabs] of this.byWindow) {
      if (n !== windowNumber) this.byWindow.set(n, tabs.filter((t) => t.key !== tab.key))
    }
    const into = (this.byWindow.get(windowNumber) ?? []).filter((t) => t.key !== tab.key)
    this.byWindow.set(windowNumber, [...into, tab])
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
 * The window number a `BrowserWindow` was created with, read back from its own `?w=` query (the
 * convention `stateKey()` reads in the renderer and `createWindow` writes in `main/index.ts`).
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
 * Not a method on `TabRegistry`: that class stays unit-testable without Electron.
 */
export function focusTab(windows: BrowserWindow[], windowNumber: number, key: string): void {
  const target = windows.find((w) => !w.isDestroyed() && windowNumberOf(w) === windowNumber)
  if (target === undefined) return
  if (target.isMinimized()) target.restore()
  target.focus()
  sendEvent(target.webContents, IPC.selectTab, key)
}
