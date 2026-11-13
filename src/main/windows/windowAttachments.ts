import type { Caller } from './caller'
import type { EventSpec } from '@shared/ipc/contract'
import { sendEvent } from './sendEvent'

/**
 * Which windows have a view attached to which thing, so a high-rate push (a
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

/** Unacknowledged output (UTF-16 units of `ptyData`) one window may hold before its pty is paused. */
export const PTY_HIGH_WATER = 1024 * 1024
/** A paused pty resumes once every attached window has at most this much unacknowledged. */
export const PTY_LOW_WATER = 256 * 1024

/** What flow control does to a key whose slowest window has fallen behind, or caught up. */
export interface FlowControl {
  pause(key: string): void
  resume(key: string): void
}

export class WindowAttachments {
  /** Per window, each attached key and how much sent to it that window has not acknowledged. */
  private readonly byWindow = new Map<number, Map<string, number>>()
  /** Keys flow control has paused. */
  private readonly paused = new Set<string>()
  private flow: FlowControl | null = null
  /** The window each key last had input from (`noteInput`), for what is meant for the person typing (`sendToInputWindow`). */
  private readonly lastInput = new Map<string, number>()

  constructor(private readonly resolve: (webContentsId: number) => SendTarget | null) {}

  attach(webContentsId: number, key: string): void {
    let keys = this.byWindow.get(webContentsId)
    if (!keys) {
      keys = new Map()
      this.byWindow.set(webContentsId, keys)
    }
    if (!keys.has(key)) keys.set(key, 0)
  }

  detach(webContentsId: number, key: string): void {
    const keys = this.byWindow.get(webContentsId)
    if (!keys) return
    keys.delete(key)
    if (keys.size === 0) this.byWindow.delete(webContentsId)
    this.settle(key)
  }

  /** A window closed or reloaded: it holds no attachments any more. Returns what it held. */
  detachWindow(webContentsId: number): string[] {
    const keys = this.byWindow.get(webContentsId)
    this.byWindow.delete(webContentsId)
    const held = keys === undefined ? [] : [...keys.keys()]
    for (const key of held) this.settle(key)
    for (const [key, wc] of this.lastInput) if (wc === webContentsId) this.lastInput.delete(key)
    return held
  }

  /**
   * Turns on flow control: a key whose attached windows have not acknowledged `PTY_HIGH_WATER` of
   * what was sent is paused, and resumed when the slowest is back to `PTY_LOW_WATER` or detaches.
   * A key no window is attached to is never paused.
   */
  controlFlow(flow: FlowControl): void { this.flow = flow }

  /** `amount` more was sent for `key` to every window attached to it. */
  recordSent(key: string, amount: number): void {
    for (const keys of this.byWindow.values()) {
      const held = keys.get(key)
      if (held !== undefined) keys.set(key, held + amount)
    }
    this.settle(key)
  }

  /** A window has drawn `amount` more of `key`. More than it was sent counts as all of it. */
  acknowledge(webContentsId: number, key: string, amount: number): void {
    const keys = this.byWindow.get(webContentsId)
    const held = keys?.get(key)
    if (keys === undefined || held === undefined) return
    keys.set(key, Math.max(0, held - amount))
    this.settle(key)
  }

  private settle(key: string): void {
    if (this.flow === null) return
    let worst = 0
    for (const keys of this.byWindow.values()) worst = Math.max(worst, keys.get(key) ?? 0)
    if (!this.paused.has(key) && worst >= PTY_HIGH_WATER) {
      this.paused.add(key)
      this.flow.pause(key)
    } else if (this.paused.has(key) && worst <= PTY_LOW_WATER) {
      this.paused.delete(key)
      this.flow.resume(key)
    }
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

  /** Window `webContentsId` typed into `key` (a keystroke, a paste, a prompt it sent). */
  noteInput(webContentsId: number, key: string): void { this.lastInput.set(key, webContentsId) }

  /**
   * Sends `event` to the window that last typed into `key`, while it still shows it: a link a
   * program opens (Claude's sign-in page) is for the person at that window, and opens once. With
   * no such window, every window attached to `key` gets it.
   */
  sendToInputWindow<P extends unknown[]>(key: string, event: EventSpec<P>, ...payload: P): void {
    const wc = this.lastInput.get(key)
    const target = wc !== undefined && this.windowsFor(key).includes(wc) ? this.resolve(wc) : null
    if (target !== null && !target.isDestroyed()) sendEvent(target, event, ...payload)
    else this.sendTo(key, event, ...payload)
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
