import { EventEmitter } from 'node:events'
import type { Caller } from '../windows/caller'
import type { ServerMessage } from './protocol'

/** Electron's own ids are small counts; these start far above them so the two never collide. */
export const VIRTUAL_ID_BASE = 1_000_000_000

/**
 * A remote window as the work machine sees it: stands in for the `WebContents` of a window that
 * lives on the home machine. Handlers and the attachment tables treat it like any caller; what it
 * `send`s becomes an `event` frame for its window on its connection. It has no `BrowserWindow` and
 * no window number, so nothing about it is stored here.
 */
export class VirtualContents implements Caller {
  private readonly emitter = new EventEmitter()
  private destroyed = false

  constructor(
    readonly id: number,
    /** The window's number on the client, the `w` of its frames. */
    readonly windowId: number,
    private readonly write: (message: ServerMessage) => void,
  ) {}

  send(channel: string, ...args: unknown[]): void {
    if (this.destroyed) return
    this.write({ t: 'event', w: this.windowId, channel, args })
  }

  isDestroyed(): boolean {
    return this.destroyed
  }

  once(event: 'destroyed', listener: () => void): this {
    this.emitter.once(event, listener)
    return this
  }

  on(event: 'did-navigate', listener: () => void): this {
    this.emitter.on(event, listener)
    return this
  }

  /** The window or its connection is gone: `'destroyed'` is emitted once. */
  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.emitter.emit('destroyed')
    this.emitter.removeAllListeners()
  }
}

/** Creates, finds and lists the virtual windows of every connection. */
export class VirtualContentsRegistry {
  private readonly byId = new Map<number, VirtualContents>()
  private next = VIRTUAL_ID_BASE

  create(windowId: number, write: (message: ServerMessage) => void): VirtualContents {
    const contents = new VirtualContents(this.next++, windowId, write)
    this.byId.set(contents.id, contents)
    contents.once('destroyed', () => { this.byId.delete(contents.id) })
    return contents
  }

  get(id: number): VirtualContents | null {
    return this.byId.get(id) ?? null
  }

  list(): VirtualContents[] {
    return [...this.byId.values()]
  }
}
