import type { Caller } from './caller'
import type { EventSpec } from '@shared/ipc/contract'
import { sendEvent } from './sendEvent'

/**
 * Which windows have a view attached to which thing (MAIN-26 step 2), so a high-rate push (a
 * pty's `ptyData`, a chat's `chatChanged`) goes only to the windows that show it instead of to
 * every window.
 *
 * A renderer declares an attachment (`ptyAttach`, `chatAttach`) when a view mounts for a key (a
 * pty id, a session id) and withdraws it (`ptyDetach`, `chatDetach`) on unmount. Several windows
 * may attach the same key (it still belongs to main); a tab moved to another window is the new
 * window attaching and the old one detaching. A window that closes or reloads loses all its
 * attachments here — a reloaded renderer starts with no views and re-attaches as they mount.
 * Keyed by webContents id, not by window object, so it needs nothing from Electron and is
 * unit-testable.
 *
 * Pty exit and state events are not routed through this: they are rare, tiny, and other code
 * (the Active section, session tracking) relies on every window hearing them.
 */
export interface SendTarget {
  isDestroyed(): boolean
  send(channel: string, ...args: unknown[]): void
}

export class WindowAttachments {
  private readonly byWindow = new Map<number, Set<string>>()

  constructor(private readonly resolve: (webContentsId: number) => SendTarget | null) {}

  attach(webContentsId: number, key: string): void {
    let keys = this.byWindow.get(webContentsId)
    if (!keys) {
      keys = new Set()
      this.byWindow.set(webContentsId, keys)
    }
    keys.add(key)
  }

  detach(webContentsId: number, key: string): void {
    const keys = this.byWindow.get(webContentsId)
    if (!keys) return
    keys.delete(key)
    if (keys.size === 0) this.byWindow.delete(webContentsId)
  }

  /** A window closed or reloaded: it holds no attachments any more. Returns what it held. */
  detachWindow(webContentsId: number): string[] {
    const keys = this.byWindow.get(webContentsId)
    this.byWindow.delete(webContentsId)
    return keys === undefined ? [] : [...keys]
  }

  /** Window ids currently attached to `key`. */
  windowsFor(key: string): number[] {
    const out: number[] = []
    for (const [wc, keys] of this.byWindow) if (keys.has(key)) out.push(wc)
    return out
  }

  /** Whether any window is attached to `key`. */
  isAttached(key: string): boolean {
    for (const keys of this.byWindow.values()) if (keys.has(key)) return true
    return false
  }

  /**
   * Sends `event` to just the windows attached to `key` — or, given several keys, to each
   * window attached to any of them, once. Drops windows that are gone.
   */
  sendTo<P extends unknown[]>(key: string | readonly string[], event: EventSpec<P>, ...payload: P): void {
    const targets = new Set<number>()
    for (const k of typeof key === 'string' ? [key] : key) for (const wc of this.windowsFor(k)) targets.add(wc)
    for (const wc of targets) {
      const target = this.resolve(wc)
      if (target === null || target.isDestroyed()) this.detachWindow(wc)
      else sendEvent(target, event, ...payload)
    }
  }
}

/**
 * A function that, called with a webContents, arranges for `onGone(id)` when that window is
 * destroyed or commits a new main-frame page (a reload): either way its renderer's views are gone
 * and will re-attach as they mount. A navigation the guard cancels never commits, so it leaves the
 * views alone. Idempotent per webContents, so call it on every attach.
 */
export function windowLifetimeWatcher(onGone: (webContentsId: number) => void): (wc: Caller) => void {
  const watched = new WeakSet<Caller>()
  return (wc) => {
    if (watched.has(wc)) return
    watched.add(wc)
    const id = wc.id
    wc.once('destroyed', () => { onGone(id) })
    wc.on('did-navigate', () => { onGone(id) })
  }
}
