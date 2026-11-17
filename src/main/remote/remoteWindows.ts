import { IPC, type IpcKey } from '@shared/ipc/contract'
import { isRecord } from '@shared/guards'
import { log } from '../log/logger'
import { sendEvent, type EventTarget } from '../windows/sendEvent'
import type { RemoteConnection } from './remoteConnection'

/** The part of a connection the router uses; a test stands in for the rest. */
export type RemoteLink = Pick<RemoteConnection, 'host' | 'isClosed' | 'openWindow' | 'closeWindow' | 'invoke' | 'send' | 'onEvent' | 'onClosed' | 'resolve' | 'callback'>
import { BRIDGED_KEYS, type BridgeHandler, type BridgedKey } from './vscodeBridge'
import { scopeOf, type ChannelScope, UNAVAILABLE_ANSWERS, UNAVAILABLE_MESSAGE } from './scopes'

/** The sends a reconnect must repeat while the window still shows what they attached; a detach cancels its attach. */
const DETACH_TO_ATTACH: Partial<Record<IpcKey, IpcKey>> = { ptyDetach: 'ptyAttach', chatDetach: 'chatAttach' }
const ATTACHES: ReadonlySet<IpcKey> = new Set<IpcKey>(['ptyAttach', 'chatAttach'])

interface Attachment { key: IpcKey; raw: unknown[] }
interface Binding {
  connection: RemoteLink; w: number; sshHost: string; attachments: Map<string, Attachment>
  /** The tab keys the window last reported (`reportTabs`): what it shows, which the work machine does not record. */
  tabs: ReadonlySet<string>
}

/** What a remote window's copy of a work machine's window may do on this machine's screen. */
export interface HomeScreen {
  raise(webContentsId: number): void
  isFocused(webContentsId: number): boolean
}

const NO_SCREEN: HomeScreen = { raise: () => {}, isFocused: () => false }

/** The keys of a `reportTabs` payload (already through the contract's guard). */
const reportedKeys = (raw: unknown[]): Set<string> =>
  new Set((Array.isArray(raw[0]) ? raw[0] : []).flatMap((t: unknown) => (isRecord(t) && typeof t.key === 'string' ? [t.key] : [])))

const isBridgedKey = (key: IpcKey): key is BridgedKey => (BRIDGED_KEYS as readonly IpcKey[]).includes(key)

export type DisconnectedListener = (webContentsIds: number[], host: string, reason: string) => void

/**
 * Which of this machine's windows show a work machine, and where their calls go
 * (docs/proposals/2026-10-10-remote-access.md). A bound window's `remote`-scope calls are forwarded
 * over its connection, its `unavailable` ones are answered here, and its `local` ones are left to
 * the handlers at home (`routeInvoke` returns `undefined`). Events of the connection are sent to the
 * bound window as the raw channel with its args.
 */
export class RemoteWindows {
  private readonly bindings = new Map<number, Binding>()
  private readonly listeners = new Set<DisconnectedListener>()
  private readonly watched = new Set<RemoteLink>()

  constructor(
    private readonly webContentsFor: (id: number) => (EventTarget & { isDestroyed(): boolean }) | null,
    /** Handles a `bridged` call (`vscodeBridge.ts`); without one such a call is refused. */
    private readonly bridge: BridgeHandler | null = null,
    private readonly screen: HomeScreen = NO_SCREEN,
  ) {}

  /**
   * Window `webContentsId` shows window `w` of `connection` from now on (opens `w` there). Binding a
   * window again (a reconnect) re-sends the attaches it had forwarded, so the work machine's virtual
   * window delivers `ptyData` and `chatChanged` again.
   */
  bind(webContentsId: number, connection: RemoteLink, w: number, sshHost: string = connection.host): void {
    const before = this.bindings.get(webContentsId)
    const attachments = before?.attachments ?? new Map<string, Attachment>()
    this.bindings.set(webContentsId, { connection, w, sshHost, attachments, tabs: before?.tabs ?? new Set() })
    this.watch(connection)
    connection.openWindow(w)
    for (const { key, raw } of attachments.values()) connection.send(w, key, raw)
  }

  /** The window no longer shows a work machine; its window there is closed. */
  unbind(webContentsId: number): void {
    const binding = this.bindings.get(webContentsId)
    if (binding === undefined) return
    this.bindings.delete(webContentsId)
    binding.connection.closeWindow(binding.w)
  }

  isBound(webContentsId: number): boolean { return this.bindings.has(webContentsId) }

  /** For `registerBroadcastSkip`: a bound window does not hear home's own `remote`-scope events. */
  readonly skipsBroadcast = (webContentsId: number, scope: ChannelScope): boolean =>
    scope === 'remote' && this.bindings.has(webContentsId)

  /** Told when a connection ends: the windows that were bound to it, its host and why. They stay bound (calls reject) until `unbind`. */
  onDisconnected(listener: DisconnectedListener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** `undefined` when the call is handled at home; otherwise the call's outcome. */
  routeInvoke(senderId: number, key: IpcKey, raw: unknown[]): Promise<unknown> | undefined {
    const binding = this.bindings.get(senderId)
    if (binding === undefined) return undefined
    const scope = scopeOf(key)
    if (scope === 'local') return undefined
    if (scope === 'bridged') {
      if (key === 'focusTab') return Promise.resolve(this.focusTab(binding, Number(raw[0]), String(raw[1])))
      if (this.bridge === null || !isBridgedKey(key)) return Promise.reject(new Error(UNAVAILABLE_MESSAGE))
      return this.bridge({ key, args: raw, sshHost: binding.sshHost, w: binding.w, connection: binding.connection })
    }
    if (scope === 'unavailable') {
      return Object.hasOwn(UNAVAILABLE_ANSWERS, key)
        ? Promise.resolve(UNAVAILABLE_ANSWERS[key])
        : Promise.reject(new Error(UNAVAILABLE_MESSAGE))
    }
    return binding.connection.invoke(binding.w, key, raw)
  }

  /** `true` when the send was handled here (forwarded or dropped); `false` when it is for the handlers at home. */
  routeSend(senderId: number, key: IpcKey, raw: unknown[]): boolean {
    const binding = this.bindings.get(senderId)
    if (binding === undefined) return false
    if (key === 'reportTabs') binding.tabs = reportedKeys(raw)
    const scope = scopeOf(key)
    if (scope === 'local') return false
    if (scope === 'remote' && !binding.connection.isClosed) {
      binding.connection.send(binding.w, key, raw)
      this.record(binding, key, raw)
    } else log.info('remote', 'dropped a send from a remote window', { key })
    return true
  }

  /**
   * `focusTab` from a remote window: the work machine's window `n` (its Active section's number) is
   * shown here by the copy bound to `n`, and a tab may since have been opened in another copy. The
   * copy that shows `key` comes first (bound to `n`, else any), then the copy of `n`; it is raised
   * and told to select the tab. False when no copy of this connection fits.
   */
  private focusTab(from: Binding, n: number, key: string): boolean {
    const copies = [...this.bindings].filter(([, b]) => b.connection === from.connection)
    const pick = copies.find(([, b]) => b.w === n && b.tabs.has(key)) ?? copies.find(([, b]) => b.tabs.has(key)) ?? copies.find(([, b]) => b.w === n)
    if (pick === undefined) return false
    const contents = this.webContentsFor(pick[0])
    if (contents === null || contents.isDestroyed()) return false
    this.screen.raise(pick[0])
    sendEvent(contents, IPC.selectTab, key)
    return true
  }

  /**
   * A work machine asks every window of a connection to open a session (a resident's `open_session`
   * cannot tell which copy the person is looking at). One copy answers, the one in front (else the
   * first): each would otherwise open it, a duplicate per window. Its renderer focuses the tab where
   * a copy shows it (`focusTab`) or opens it there.
   */
  private openSessionOnce(connection: RemoteLink, w: number, args: unknown[]): void {
    const copies = [...this.bindings].filter(([, b]) => b.connection === connection).sort(([, a], [, b]) => a.w - b.w)
    if (copies[0]?.[1].w !== w) return
    const [id] = copies.find(([wc]) => this.screen.isFocused(wc)) ?? copies[0]
    const contents = this.webContentsFor(id)
    if (contents !== null && !contents.isDestroyed()) contents.send(IPC.openSessionRequested.channel, ...args)
  }

  private record(binding: Binding, key: IpcKey, raw: unknown[]): void {
    if (ATTACHES.has(key)) binding.attachments.set(`${key}:${JSON.stringify(raw)}`, { key, raw })
    const attach = DETACH_TO_ATTACH[key]
    if (attach !== undefined) binding.attachments.delete(`${attach}:${JSON.stringify(raw)}`)
  }

  private watch(connection: RemoteLink): void {
    if (this.watched.has(connection)) return
    this.watched.add(connection)
    const offEvent = connection.onEvent((w, channel, args) => {
      if (channel === IPC.openSessionRequested.channel) { this.openSessionOnce(connection, w, args); return }
      for (const [id, binding] of this.bindings) {
        if (binding.connection !== connection || binding.w !== w) continue
        const contents = this.webContentsFor(id)
        if (contents !== null && !contents.isDestroyed()) contents.send(channel, ...args)
      }
    })
    connection.onClosed((reason) => {
      offEvent()
      this.watched.delete(connection)
      const ids = [...this.bindings].filter(([, b]) => b.connection === connection).map(([id]) => id)
      for (const listener of [...this.listeners]) listener(ids, connection.host, reason)
    })
  }
}
