import { IPC, type TabTransfer } from '@shared/api'
import { asPtyId } from '@shared/domain/ids'
import { pickWindowAt } from './windowAtPoint'
import type { TabRegistry } from './tabRegistry'
import { sendEvent } from './sendEvent'

/** The slice of `BrowserWindow` (and its `webContents`) `TabMover` needs — narrowed so a unit test
 *  can pass a plain object instead of a real Electron window (MAIN-13 step 3). */
export interface MovableWindow {
  webContents: { id: number; send: (channel: string, ...args: unknown[]) => void }
  isDestroyed: () => boolean
  isVisible: () => boolean
  getBounds: () => { x: number; y: number; width: number; height: number }
  focus: () => void
}

export interface TabMoverDeps {
  /** Read fresh every time — windows come and go. */
  getWindows: () => MovableWindow[]
  tabRegistry?: TabRegistry | null
  /** Only `has` is needed, so a test can pass a fake rather than a real `PtyManager`. */
  pty: { has: (key: string) => boolean }
  openDetachedWindow?: (tab: TabTransfer, at: { x: number; y: number }) => number
  windowNumberFor?: (webContentsId: number) => number | null
}

/**
 * Cross-window tab moves: focus-order tracking, hit-testing, hand-over and claim announcements
 * (MAIN-13 step 3), pulled out of `ipc/handlers/tabs.ts`'s composition so the decision — which
 * window a drop lands on, and who gets told to give the tab up — can be driven with fake windows in
 * a unit test.
 *
 * See CLAUDE.md "Windows, and what belongs to which": an HTML5 drag started in one `BrowserWindow`
 * delivers no `dragover`/`drop` to another, so the drop target is worked out from geometry
 * (`pickWindowAt`) rather than from an event that never arrives.
 */
export class TabMover {
  /** webContents ids, most recently focused first — `pickWindowAt`'s stand-in for z-order. */
  private focusOrder: number[] = []

  constructor(private readonly deps: TabMoverDeps) {}

  /** Call from an `app.on('browser-window-focus', ...)` listener. */
  rememberFocus(webContentsId: number): void {
    const at = this.focusOrder.indexOf(webContentsId)
    if (at !== -1) this.focusOrder.splice(at, 1)
    this.focusOrder.unshift(webContentsId)
  }

  /** The topmost window under a screen point, or null for none. */
  windowUnder(at: { x: number; y: number }): MovableWindow | null {
    const windows = this.deps.getWindows().filter((w) => !w.isDestroyed())
    const id = pickWindowAt(
      windows.map((w) => ({ id: w.webContents.id, ...w.getBounds(), visible: w.isVisible() })),
      this.focusOrder,
      at,
    )
    return windows.find((w) => w.webContents.id === id) ?? null
  }

  /** Tells every window but `keeper` that a tab it may be showing now belongs somewhere else. */
  announceClaimed(key: string, keeper: number | null): void {
    for (const win of this.deps.getWindows()) {
      if (win.isDestroyed() || win.webContents.id === keeper) continue
      sendEvent(win.webContents, IPC.tabClaimed, key)
    }
  }

  /**
   * Files a moved tab under the window it went to at the moment of the move. Each window reports
   * its own tabs, but the receiving one only after it has loaded (a new window) or adopted the tab,
   * plus the 500ms report debounce — while the window it left reports its loss at once. In that gap
   * the tab was in no window at all, and dropped out of Active for a second or two.
   */
  handOver(tab: TabTransfer, toWindow: number | null): void {
    if (toWindow === null || !this.deps.tabRegistry) return
    this.deps.tabRegistry.handOver(toWindow, {
      windowNumber: toWindow,
      key: tab.key,
      view: tab.view,
      ptyId: tab.ptyId ?? (this.deps.pty.has(tab.key) ? asPtyId(tab.key) : null),
      label: null,
    })
  }

  /** `deps.openDetachedWindow`, resolved to a window number in the same call — a thin pass-through
   *  so callers do not have to know both APIs exist. */
  openDetachedWindow(tab: TabTransfer, at: { x: number; y: number }): number | null {
    return this.deps.openDetachedWindow?.(tab, at) ?? null
  }

  windowNumberFor(webContentsId: number): number | null {
    return this.deps.windowNumberFor?.(webContentsId) ?? null
  }
}
