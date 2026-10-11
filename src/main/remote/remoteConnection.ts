import { connect, type Socket } from 'node:net'
import type { IpcKey } from '@shared/ipc/contract'
import { errorMessage } from '@shared/errors'
import { pairingErrorMessage } from '@shared/domain/remote'
import { isRecord } from '@shared/guards'
import { log } from '../log/logger'
import { encodeFrame, encodeHandshakeFrame, FrameDecoder } from './frames'
import { contractHash, PROTOCOL_VERSION, type ClientMessage, type RemoteWindowLayout, type ResolveRequest, type Resolved, type ServerMessage } from './protocol'

export interface RemoteConnectOptions {
  appVersion: string
  /** What to call the machine in errors until it has said its own name (`welcome`). */
  host?: string
  /** This machine's name, shown in the work machine's list of who is connected. Informational. */
  client?: string
  /** The pairing code, when the work machine asks for one. Never logged. */
  pairing?: string
}

/** The start of the message for a socket that could not be reached (a refusal has the server's own words instead). */
export const UNREACHABLE_PREFIX = 'Could not reach Apiary on'

type EventListener = (w: number, channel: string, args: unknown[]) => void

interface Pending { resolve(value: unknown): void; reject(error: Error): void }

/**
 * The home machine's end of a connection to a work machine's `RemoteServer`
 * (docs/proposals/2026-10-10-remote-access.md): one socket, any number of remote windows. It speaks
 * the protocol (`protocol.ts`) and nothing else; which window's calls go here is `RemoteWindows`'
 * business.
 *
 * There is no per-call timeout: a git pull may take minutes, and the socket closing is what ends a
 * call that will never be answered. Logged: connecting and closing. Never a payload.
 */
export class RemoteConnection {
  private readonly pending = new Map<number, Pending>()
  private readonly eventListeners = new Set<EventListener>()
  private readonly closedListeners = new Set<(reason: string) => void>()
  private nextId = 1
  private closed = false

  private constructor(private readonly socket: Socket, readonly host: string) {}

  /** Connects, says hello and resolves on `welcome`; rejects with the server's message on a refusal. */
  static connect(socketPath: string, options: RemoteConnectOptions): Promise<RemoteConnection> {
    const fallbackHost = options.host ?? 'the work machine'
    const unreachable = new Error(`${UNREACHABLE_PREFIX} ${fallbackHost}`)
    return new Promise<RemoteConnection>((resolve, reject) => {
      const socket = connect(socketPath)
      const decoder = new FrameDecoder()
      let connection: RemoteConnection | null = null
      let settled = false
      const fail = (error: Error): void => {
        if (settled) return
        settled = true
        socket.destroy()
        reject(error)
      }
      socket.on('error', (error) => {
        log.warn('remote', 'connection error', { error })
        if (connection === null) fail(unreachable)
        else connection.shutdown(`Disconnected from ${connection.host}`)
      })
      socket.on('close', () => {
        if (connection === null) fail(unreachable)
        else connection.shutdown(`Disconnected from ${connection.host}`)
      })
      socket.on('connect', () => {
        const hello: ClientMessage = { t: 'hello', protocol: PROTOCOL_VERSION, contract: contractHash(), appVersion: options.appVersion,
          ...(options.client !== undefined ? { client: options.client } : {}),
          ...(options.pairing !== undefined ? { pairing: options.pairing } : {}),
        }
        // JSON, so a work machine on another Apiary version can still read it and answer "refused".
        socket.write(encodeHandshakeFrame(hello))
      })
      socket.on('data', (chunk: Buffer) => {
        let messages: unknown[]
        try {
          messages = decoder.push(chunk)
        } catch (error) {
          log.warn('remote', 'bad data from the work machine', { error })
          if (connection === null) fail(unreachable)
          else connection.shutdown(`Disconnected from ${connection.host}`)
          return
        }
        for (const message of messages) {
          if (!isServerMessage(message)) continue
          if (connection !== null) { connection.handle(message); continue }
          if (message.t === 'welcome') {
            connection = new RemoteConnection(socket, message.host)
            settled = true
            log.info('remote', 'connected')
            resolve(connection)
          } else if (message.t === 'refused') {
            const { reason } = message
            const pairing = reason === 'pairing-required' || reason === 'pairing-wrong' || reason === 'rate-limited'
            fail(new Error(pairing ? pairingErrorMessage(reason, fallbackHost) : message.message))
          }
        }
      })
    })
  }

  openWindow(w: number): void { this.write({ t: 'open', w }) }
  closeWindow(w: number): void { this.write({ t: 'close', w }) }

  invoke(w: number, key: IpcKey, args: unknown[]): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error(`Disconnected from ${this.host}`))
    const id = this.nextId++
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.write({ t: 'invoke', id, w, key, args }, (error) => {
        this.pending.delete(id)
        reject(error)
      })
    })
  }

  send(w: number, key: IpcKey, args: unknown[]): void { this.write({ t: 'send', w, key, args }) }

  /** Asks the work machine where a session's folder, or a mentioned file, is. Rejects with its reason. */
  async resolve(w: number, request: ResolveRequest): Promise<Resolved> {
    return (await this.invokeFrame((id) => ({ t: 'resolve', id, w, ...request }))) as Resolved
  }

  /** The work machine's windows and their layouts, to seed this machine's copies. */
  async layouts(): Promise<RemoteWindowLayout[]> {
    const result = await this.invokeFrame((id) => ({ t: 'layouts', id }))
    return result as RemoteWindowLayout[]
  }

  onEvent(listener: EventListener): () => void {
    this.eventListeners.add(listener)
    return () => { this.eventListeners.delete(listener) }
  }

  /** Called once, when the connection ends for any reason (including `close()`). */
  onClosed(listener: (reason: string) => void): () => void {
    this.closedListeners.add(listener)
    return () => { this.closedListeners.delete(listener) }
  }

  close(): void {
    this.shutdown(`Disconnected from ${this.host}`)
    this.socket.destroy()
  }

  get isClosed(): boolean { return this.closed }

  private invokeFrame(make: (id: number) => ClientMessage): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error(`Disconnected from ${this.host}`))
    const id = this.nextId++
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.write(make(id), (error) => { this.pending.delete(id); reject(error) })
    })
  }

  private write(message: ClientMessage, onError?: (error: Error) => void): void {
    if (this.closed || this.socket.destroyed) { onError?.(new Error(`Disconnected from ${this.host}`)); return }
    try {
      this.socket.write(encodeFrame(message))
    } catch (error) {
      log.warn('remote', 'could not send a message', { type: message.t, error })
      onError?.(new Error(errorMessage(error)))
    }
  }

  private handle(message: ServerMessage): void {
    switch (message.t) {
      case 'result': {
        const call = this.pending.get(message.id)
        if (call === undefined) return
        this.pending.delete(message.id)
        if (message.ok) call.resolve(message.value)
        else call.reject(new Error(message.message))
        return
      }
      case 'layouts': {
        const call = this.pending.get(message.id)
        this.pending.delete(message.id)
        call?.resolve(message.windows)
        return
      }
      case 'resolved': {
        const call = this.pending.get(message.id)
        if (call === undefined) return
        this.pending.delete(message.id)
        if (message.ok) call.resolve(message.line === undefined ? { path: message.path } : { path: message.path, line: message.line })
        else call.reject(new Error(message.message))
        return
      }
      case 'event':
        for (const listener of [...this.eventListeners]) listener(message.w, message.channel, message.args)
        return
      case 'welcome': case 'refused': return
    }
  }

  private shutdown(reason: string): void {
    if (this.closed) return
    this.closed = true
    log.info('remote', 'disconnected')
    const error = new Error(reason)
    for (const call of this.pending.values()) call.reject(error)
    this.pending.clear()
    for (const listener of [...this.closedListeners]) listener(reason)
    this.closedListeners.clear()
    this.eventListeners.clear()
  }
}

function isServerMessage(value: unknown): value is ServerMessage {
  return isRecord(value) && typeof value.t === 'string'
}
