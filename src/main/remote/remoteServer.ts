import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { chmod, mkdir, rm } from 'node:fs/promises'
import { normalizePairingCode, pairingErrorMessage, type RefusalReason, type RemoteClientInfo } from '@shared/domain/remote'
import { createServer, type Server, type Socket } from 'node:net'
import { join } from 'node:path'
import { IPC, type InvokeKey, type IpcKey, type SendKey } from '@shared/ipc/contract'
import { errorMessage } from '@shared/errors'
import { isRecord } from '@shared/guards'
import { log } from '../log/logger'
import type { Dispatcher } from '../ipc/registrar'
import type { WindowLayoutRecord } from '../windows/sessionLayoutStore'
import { encodeFrame, encodeHandshakeFrame, FrameDecoder } from './frames'
import {
  contractHash, PROTOCOL_VERSION, type ClientMessage, type RemoteWindowLayout, type ServerMessage,
} from './protocol'
import { scopeOf } from './scopes'
import type { VsCodeService } from '../vscode/vscodeService'
import type { VirtualContents, VirtualContentsRegistry } from './virtualContents'

const HELLO_TIMEOUT_MS = 5000
const NOT_ALLOWED = 'Not allowed remotely'

export interface RemoteServerDeps {
  /** The user's home directory; the socket is `<home>/.apiary/remote.sock`. Injected so a test uses a temp dir. */
  homeDir: string
  /** This machine's name, shown to the client in `welcome` and in a refusal. */
  host: string
  appVersion: string
  registry: VirtualContentsRegistry
  /** The `SessionLayoutStore` records the client seeds its copies from. */
  layouts: () => readonly WindowLayoutRecord[]
  /** Resolves the paths `resolve` asks for (`VsCodeService`); without it every `resolve` is refused. */
  vscode?: Pick<VsCodeService, 'resolveFolder' | 'resolveMentionedFile'>
  helloTimeoutMs?: number
  /** The optional pairing code: asked for only while `required()`; `code()` is its stored (no dash) form. */
  pairing?: { required(): boolean; code(): string }
  /** "Disconnect all" turns the `remoteAccess` setting off through this, so nothing reconnects by itself. */
  turnOff?: () => void
  now?: () => number
}

/** Wrong codes allowed within `PAIRING_WINDOW_MS`, from any client, before every attempt is refused for as long. */
const PAIRING_MAX_WRONG = 5
const PAIRING_WINDOW_MS = 60_000

/** Constant-time comparison of two codes (equal-length buffers, as `timingSafeEqual` needs). */
function sameCode(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

/** What `checkHello` decides: accept, or refuse with a reason and the words for it. */
type HelloVerdict = { ok: true } | { ok: false; reason: RefusalReason; message: string }

interface Live { id: string; client: string; connectedAt: number; windows: Map<number, VirtualContents> }

/**
 * The work machine's end of remote access (docs/proposals/2026-10-10-remote-access.md): a Unix
 * socket in `~/.apiary` that the home machine reaches through SSH's socket forwarding. Each
 * connection says hello (versions must match), then opens windows; a call from one runs through the
 * same `Dispatcher` a local window's does, with a `VirtualContents` as its sender. Only channels
 * whose scope is `remote` (`scopes.ts`) are served, whatever the client sends.
 *
 * Logged: connections opening and closing, refusals. Never a payload.
 */
export class RemoteServer {
  private server: Server | null = null
  private dispatcher: Dispatcher | null = null
  private readonly connections = new Set<Socket>()
  /** The clients that said hello and are still connected. */
  private readonly live = new Set<Live>()
  private readonly listeners = new Set<(clients: RemoteClientInfo[]) => void>()
  /** When each recent wrong pairing code was tried; entries older than the window are dropped. */
  private wrongCodes: number[] = []
  private pairingBlockedUntil = 0

  constructor(private readonly deps: RemoteServerDeps) {}

  /** The home machines connected now, oldest first. */
  clients(): RemoteClientInfo[] {
    return [...this.live].map((c) => ({ id: c.id, client: c.client, connectedAt: c.connectedAt, windows: c.windows.size }))
  }

  /** Called with the whole list whenever a client connects, leaves or opens or closes a window. */
  subscribe(listener: (clients: RemoteClientInfo[]) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Closes every connection and turns remote access off (the home side reconnects by itself otherwise). */
  disconnectAll(): void {
    log.info('remote', 'disconnect all', { clients: this.live.size })
    this.deps.turnOff?.()
    for (const socket of [...this.connections]) socket.destroy()
  }

  private changed(): void {
    const clients = this.clients()
    for (const listener of [...this.listeners]) listener(clients)
  }

  get socketPath(): string {
    return join(this.deps.homeDir, '.apiary', 'remote.sock')
  }

  /** Hands over the dispatcher once `registerIpc` has built it. */
  attachDispatcher(dispatcher: Dispatcher): void {
    this.dispatcher = dispatcher
  }

  async start(): Promise<void> {
    if (this.server !== null) return
    const dir = join(this.deps.homeDir, '.apiary')
    await mkdir(dir, { recursive: true, mode: 0o700 })
    // `mkdir`'s mode does not apply to a directory that already exists.
    await chmod(dir, 0o700)
    await rm(this.socketPath, { force: true })
    const server = createServer((socket) => { this.accept(socket) })
    this.server = server
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(this.socketPath, () => { server.off('error', reject); resolve() })
    })
    await chmod(this.socketPath, 0o600)
    server.on('error', (error) => { log.warn('remote', 'server error', { error }) })
    log.info('remote', 'listening')
  }

  async stop(): Promise<void> {
    const server = this.server
    if (server === null) return
    this.server = null
    for (const socket of [...this.connections]) socket.destroy()
    await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    await rm(this.socketPath, { force: true })
    log.info('remote', 'stopped')
  }

  private accept(socket: Socket): void {
    this.connections.add(socket)
    log.info('remote', 'connection opened')
    const windows = new Map<number, VirtualContents>()
    const decoder = new FrameDecoder()
    let greeted = false
    const write = (message: ServerMessage): void => {
      if (socket.destroyed) return
      try {
        // The handshake's answers are JSON, readable by any version; the rest is V8 (frames.ts).
        socket.write(message.t === 'welcome' || message.t === 'refused' ? encodeHandshakeFrame(message) : encodeFrame(message))
      } catch (error) {
        log.warn('remote', 'could not send a message', { type: message.t, error })
        if (message.t === 'result' && message.ok) write({ t: 'result', id: message.id, ok: false, message: errorMessage(error) })
      }
    }
    const refuse = (message: string, reason: RefusalReason): void => {
      write({ t: 'refused', message, reason })
      socket.end()
    }
    let entry: Live | null = null
    const helloTimer = setTimeout(() => {
      if (greeted) return
      log.warn('remote', 'no hello in time; closing')
      socket.destroy()
    }, this.deps.helloTimeoutMs ?? HELLO_TIMEOUT_MS)

    const handle = (message: ClientMessage): void => {
      if (!greeted) {
        if (message.t !== 'hello') { socket.destroy(); return }
        const verdict = this.checkHello(message)
        if (!verdict.ok) {
          clearTimeout(helloTimer)
          log.warn('remote', 'refused a connection', { reason: verdict.reason })
          refuse(verdict.message, verdict.reason)
          return
        }
        greeted = true
        clearTimeout(helloTimer)
        // `client` is informational (shown to the user), so it is trimmed and capped, never relied on.
        const client = (message.client ?? '').trim().slice(0, 100) || 'a remote machine'
        entry = { id: randomUUID(), client, connectedAt: (this.deps.now ?? Date.now)(), windows }
        this.live.add(entry)
        write({ t: 'welcome', host: this.deps.host, appVersion: this.deps.appVersion })
        this.changed()
        return
      }
      switch (message.t) {
        case 'hello': return
        case 'open':
          if (!windows.has(message.w)) {
            windows.set(message.w, this.deps.registry.create(message.w, write))
            this.changed()
          }
          return
        case 'close':
          windows.get(message.w)?.destroy()
          if (windows.delete(message.w)) this.changed()
          return
        case 'invoke': void this.invoke(message, windows.get(message.w) ?? null, write); return
        case 'send': this.send(message, windows.get(message.w) ?? null); return
        case 'resolve': void this.resolve(message, write); return
        case 'layouts': write({ t: 'layouts', id: message.id, windows: this.layouts() }); return
      }
    }

    socket.on('data', (chunk: Buffer) => {
      try {
        for (const message of decoder.push(chunk)) {
          if (!isClientMessage(message)) throw new Error('Unrecognised message.')
          handle(message)
        }
      } catch (error) {
        log.warn('remote', 'bad data; closing the connection', { error })
        socket.destroy()
      }
    })
    socket.on('error', (error) => { log.warn('remote', 'connection error', { error }) })
    socket.on('close', () => {
      clearTimeout(helloTimer)
      for (const win of windows.values()) win.destroy()
      windows.clear()
      this.connections.delete(socket)
      log.info('remote', 'connection closed')
      if (entry !== null && this.live.delete(entry)) this.changed()
    })
  }

  private checkHello(hello: Extract<ClientMessage, { t: 'hello' }>): HelloVerdict {
    const contract = contractHash()
    if (!(hello.protocol === PROTOCOL_VERSION && hello.contract === contract && hello.appVersion === this.deps.appVersion)) {
      const detail = hello.appVersion === this.deps.appVersion ? ' (a different build)' : ''
      return {
        ok: false, reason: 'version',
        message: `${this.deps.host} runs Apiary ${this.deps.appVersion}; this machine runs ${hello.appVersion}${detail}. Update one of them.`,
      }
    }
    return this.checkPairing(hello.pairing)
  }

  /**
   * The optional pairing code (SSH stays the authentication). No code is "required", not a failed
   * try; a wrong one counts, and `PAIRING_MAX_WRONG` of them within `PAIRING_WINDOW_MS`, from any
   * client, refuse every attempt (even a right code) until the window has passed.
   */
  private checkPairing(given: string | undefined): HelloVerdict {
    const pairing = this.deps.pairing
    if (pairing === undefined || !pairing.required()) return { ok: true }
    const now = (this.deps.now ?? Date.now)()
    const host = this.deps.host
    if (now < this.pairingBlockedUntil) {
      return { ok: false, reason: 'rate-limited', message: pairingErrorMessage('rate-limited', host) }
    }
    if (given === undefined || given === '') {
      return { ok: false, reason: 'pairing-required', message: pairingErrorMessage('pairing-required', host) }
    }
    if (sameCode(normalizePairingCode(given), pairing.code())) return { ok: true }
    this.wrongCodes = this.wrongCodes.filter((at) => now - at < PAIRING_WINDOW_MS)
    this.wrongCodes.push(now)
    if (this.wrongCodes.length >= PAIRING_MAX_WRONG) {
      this.pairingBlockedUntil = now + PAIRING_WINDOW_MS
      this.wrongCodes = []
    }
    return { ok: false, reason: 'pairing-wrong', message: pairingErrorMessage('pairing-wrong', host) }
  }

  private layouts(): RemoteWindowLayout[] {
    return this.deps.layouts().map(({ bounds: _bounds, ...layout }) => ({ windowNumber: layout.number, layout }))
  }

  /** The key if a remote window may call it as `kind`, else null (and a warning). */
  private allowed(key: string, kind: 'invoke' | 'send'): IpcKey | null {
    const ok = Object.hasOwn(IPC, key) && IPC[key as IpcKey].kind === kind && scopeOf(key as IpcKey) === 'remote'
    if (!ok) log.warn('remote', 'refused a call', { key: key.slice(0, 64), kind })
    return ok ? (key as IpcKey) : null
  }

  private async invoke(
    message: Extract<ClientMessage, { t: 'invoke' }>, win: VirtualContents | null, write: (m: ServerMessage) => void,
  ): Promise<void> {
    const fail = (text: string): void => { write({ t: 'result', id: message.id, ok: false, message: text }) }
    const key = this.allowed(message.key, 'invoke')
    if (key === null) { fail(NOT_ALLOWED); return }
    if (win === null || this.dispatcher === null) { fail('Window not open.'); return }
    try {
      const value = await this.dispatcher.invoke(key as InvokeKey, { sender: win }, message.args)
      write({ t: 'result', id: message.id, ok: true, value })
    } catch (error) {
      fail(errorMessage(error))
    }
  }

  /** Answers where a path is; never launches anything (home launches its own VS Code). */
  private async resolve(
    message: Extract<ClientMessage, { t: 'resolve' }>, write: (m: ServerMessage) => void,
  ): Promise<void> {
    const vscode = this.deps.vscode
    try {
      if (vscode === undefined) throw new Error(NOT_ALLOWED)
      if (message.what === 'session-folder') {
        if (!IPC.openInVsCode.args([message.terminal])) throw new Error('Invalid request.')
        write({ t: 'resolved', id: message.id, ok: true, path: vscode.resolveFolder(message.terminal) })
      } else {
        if (!IPC.openMentionedFile.args([message.terminal, message.mention])) throw new Error('Invalid request.')
        const found = await vscode.resolveMentionedFile(message.terminal, message.mention)
        write({ t: 'resolved', id: message.id, ok: true, path: found.file, ...(found.line === null ? {} : { line: found.line }) })
      }
    } catch (error) {
      write({ t: 'resolved', id: message.id, ok: false, message: errorMessage(error) })
    }
  }

  private send(message: Extract<ClientMessage, { t: 'send' }>, win: VirtualContents | null): void {
    const key = this.allowed(message.key, 'send')
    if (key === null || win === null || this.dispatcher === null) return
    this.dispatcher.send(key as SendKey, { sender: win }, message.args)
  }
}

function isClientMessage(value: unknown): value is ClientMessage {
  if (!isRecord(value) || typeof value.t !== 'string') return false
  switch (value.t) {
    case 'hello':
      return typeof value.protocol === 'number' && typeof value.contract === 'string' && typeof value.appVersion === 'string'
        && (value.client === undefined || typeof value.client === 'string') && (value.pairing === undefined || typeof value.pairing === 'string')
    case 'open': case 'close': return typeof value.w === 'number'
    case 'invoke': return typeof value.id === 'number' && typeof value.w === 'number' && typeof value.key === 'string' && Array.isArray(value.args)
    case 'send': return typeof value.w === 'number' && typeof value.key === 'string' && Array.isArray(value.args)
    case 'layouts': return typeof value.id === 'number'
    case 'resolve': return typeof value.id === 'number' && typeof value.w === 'number' && (value.what === 'session-folder' || value.what === 'mentioned-file')
    default: return false
  }
}
