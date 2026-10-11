import type { IpcKey } from '@shared/ipc/contract'
import { log } from '../log/logger'
import type { EventTarget } from '../windows/sendEvent'
import type { RemoteConnection } from './remoteConnection'

/** The part of a connection the router uses; a test stands in for the rest. */
export type RemoteLink = Pick<RemoteConnection, 'host' | 'isClosed' | 'openWindow' | 'closeWindow' | 'invoke' | 'send' | 'onEvent' | 'onClosed' | 'resolve'>
import type { BridgeHandler } from './vscodeBridge'
import { scopeOf, type ChannelScope, UNAVAILABLE_ANSWERS, UNAVAILABLE_MESSAGE } from './scopes'

/** The sends a reconnect must repeat while the window still shows what they attached; a detach cancels its attach. */
const DETACH_TO_ATTACH: Partial<Record<IpcKey, IpcKey>> = { ptyDetach: 'ptyAttach', chatDetach: 'chatAttach' }
const ATTACHES: ReadonlySet<IpcKey> = new Set<IpcKey>(['ptyAttach', 'chatAttach'])

interface Attachment { key: IpcKey; raw: unknown[] }
interface Binding { connection: RemoteLink; w: number; sshHost: string; attachments: Map<string, Attachment> }

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
  ) {}

  /**
   * Window `webContentsId` shows window `w` of `connection` from now on (opens `w` there). Binding a
   * window again (a reconnect) re-sends the attaches it had forwarded, so the work machine's virtual
   * window delivers `ptyData` and `chatChanged` again.
   */
  bind(webContentsId: number, connection: RemoteLink, w: number, sshHost: string = connection.host): void {
    const attachments = this.bindings.get(webContentsId)?.attachments ?? new Map<string, Attachment>()
    this.bindings.set(webContentsId, { connection, w, sshHost, attachments })
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
      if (this.bridge === null || (key !== 'openInVsCode' && key !== 'openMentionedFile')) return Promise.reject(new Error(UNAVAILABLE_MESSAGE))
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
    const scope = scopeOf(key)
    if (scope === 'local') return false
    if (scope === 'remote' && !binding.connection.isClosed) {
      binding.connection.send(binding.w, key, raw)
      this.record(binding, key, raw)
    } else log.info('remote', 'dropped a send from a remote window', { key })
    return true
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
