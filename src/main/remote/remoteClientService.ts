import { pairingError, pairingErrorMessage, type RemoteStatus } from '@shared/domain/remote'
import { errorMessage } from '@shared/errors'
import { isRecord } from '@shared/guards'
import { log } from '../log/logger'
import { fireAndForget } from '../log/fireAndForget'
import type { ExecFn } from '../exec/run'
import { UNREACHABLE_PREFIX, type RemoteConnectOptions } from './remoteConnection'
import type { RemoteLink, RemoteWindows } from './remoteWindows'
import { describeSshFailure, forwardFlags, homeDirArgs, startAppArgs } from './sshCommand'
import type { SshTunnel, StartSshTunnel } from './sshTunnel'
import type { RemoteWindowLayout } from './protocol'
import type { SavedPairingCodes } from './savedPairingCodes'

/** The part of a connection this service uses. */
export type ClientConnection = RemoteLink & { layouts(): Promise<RemoteWindowLayout[]>; close(): void }

/** A window the manager just created, before its page has loaded. */
interface CreatedWindow {
  webContentsId: number
  onClosed(listener: () => void): void
}

export interface RemoteClientDeps {
  appVersion: string
  /** `APIARY_SSH_CONFIG`, test-only. */
  sshConfig: string | undefined
  /** Short-lived ssh through the login shell (`sshExec`, 20 s), the same environment as the tunnel. */
  exec: ExecFn
  startTunnel: StartSshTunnel
  connect(socketPath: string, options: RemoteConnectOptions): Promise<ClientConnection>
  /** Makes a private (0700) directory and returns its path. */
  makeTempDir(): Promise<string>
  removeDir(dir: string): Promise<void>
  socketExists(path: string): boolean
  /** Opens a local window showing the work machine's layout `layout` (if any). */
  openWindow(host: string, layout: unknown): CreatedWindow
  /** Brings a window to the front (a second connect to a connected host). */
  focusWindow(webContentsId: number): void
  windows: Pick<RemoteWindows, 'bind' | 'unbind' | 'onDisconnected'>
  sendStatus(webContentsId: number, status: RemoteStatus): void
  /** A connection to `host` is up and its window open (the host directory remembers it). */
  onConnected?(host: string): void
  /** The pairing codes that worked, encrypted at rest (main only). Omitted: none is kept. */
  pairingCodes?: Pick<SavedPairingCodes, 'get' | 'save' | 'forget' | 'canSave'>
  /** How long to wait for the forwarded socket, and how often to look. */
  socketWaitMs?: number
  pollMs?: number
  /** One probe of `host` now (`HostDirectory.probeNow`): ready, off or stopped; rejects when ssh cannot get in. */
  probe(host: string): Promise<'ready' | 'off' | 'stopped'>
  /** How long `startRemoteApp` waits for the work machine's socket, and how often it asks. */
  startWaitMs?: number
  startPollMs?: number
}

/** One ssh tunnel, its temp directory and the connection over it. */
interface Link { dir: string; tunnel: SshTunnel; connection: ClientConnection }

/** Everything one work machine's windows share; it ends when the last window closes. */
interface Session {
  host: string
  /** Replaced on each reconnect. */
  link: Link
  /** The pairing code that got in, kept for reconnects when it could not be saved. */
  pairing: string | null
  /** Each local window and the work machine's window number it shows. */
  windows: Map<number, number>
  stopped: boolean
  reconnecting: boolean
  /** Set when ssh died first, so the windows hear why in ssh's words. */
  lostReason: string | null
  cancelSleep: (() => void) | null
}

/** The pairing code a connect sends, and whether it came from the saved ones. */
interface CodeToSend { code: string | null; saved: boolean }

/** A refusal that will not fix itself (a version mismatch, remote access off): retrying is pointless. */
class FinalRefusal extends Error {}

const SOCKET_WAIT_MS = 15_000
const POLL_MS = 50
const START_WAIT_MS = 20_000
const START_POLL_MS = 1000
/** Wait before each retry: 1, 2, 5, 10 s, then every 30 s. */
const BACKOFF_MS = [1000, 2000, 5000, 10_000]
const BACKOFF_REPEAT_MS = 30_000
const NOT_ACCEPTING = (host: string): string =>
  `Apiary on ${host} is not accepting remote connections. Turn on Settings → General → Allow remote access over SSH there, and keep Apiary open.`

/**
 * The home machine's way into a work machine (docs/proposals/2026-10-10-remote-access.md): asks it
 * for its home directory over ssh, forwards its Apiary socket to a private local one, connects a
 * `RemoteConnection` and opens one window per window of the work machine, each bound to it. When the
 * connection or ssh drops the windows stay, say they are reconnecting, and the whole connect is
 * retried with a backoff while one of them is open; closing the last one stops it and everything it
 * started. A refusal that will not fix itself ends the retrying with a disconnected banner.
 * Logged: start, success, failure (the message a person sees), reconnect attempts and disconnect.
 * Never a payload or a home directory.
 */
export class RemoteClientService {
  private readonly sessions = new Map<string, Session>()

  constructor(private readonly deps: RemoteClientDeps) {
    deps.windows.onDisconnected((ids, host, reason) => {
      const session = this.sessions.get(host)
      if (session === undefined || !ids.some((id) => session.windows.has(id))) {
        log.info('remote', 'disconnected', { host })
        for (const id of ids) this.deps.sendStatus(id, { state: 'disconnected', host, message: reason })
        return
      }
      if (session.reconnecting || session.stopped) return
      log.info('remote', 'disconnected, reconnecting', { host })
      const message = session.lostReason ?? reason
      session.lostReason = null
      fireAndForget(this.reconnect(session, message), 'remote')
    })
  }

  /** Resolves once every window is open; rejects with a sentence a person can act on. */
  async connect(host: string, typedCode?: string): Promise<void> {
    const existing = this.sessions.get(host)
    if (existing !== undefined) {
      const first = [...existing.windows.keys()][0]
      if (first !== undefined) this.deps.focusWindow(first)
      return
    }
    log.info('remote', 'connect start', { host })
    try {
      const code = this.codeFor(host, typedCode)
      const link = await this.establish(host, code)
      if (typedCode !== undefined) this.deps.pairingCodes?.save(host, typedCode)
      const session: Session = { host, link, pairing: code.code, windows: new Map(), stopped: false, reconnecting: false, lostReason: null, cancelSleep: null }
      this.sessions.set(host, session)
      this.watchTunnel(session, link)
      try {
        await this.openRemoteWindows(session)
      } catch (error) {
        await this.teardown(session)
        throw error
      }
      log.info('remote', 'connected', { host })
      this.deps.onConnected?.(host)
    } catch (error) {
      const message = errorMessage(error)
      log.warn('remote', 'connect failed', { host, message })
      throw new Error(message, { cause: error })
    }
  }

  /**
   * Apiary is installed on `host` but not running: starts it there in the background over ssh, waits
   * for its socket (the probe, every second, up to 20 s) and connects. Rejects with a sentence a
   * person can act on.
   */
  async startRemoteApp(host: string): Promise<void> {
    log.info('remote', 'start remote app', { host })
    try {
      await this.deps.exec('ssh', startAppArgs(host, this.deps.sshConfig), process.cwd())
    } catch (error) {
      log.warn('remote', 'could not start the remote app', { host, message: errorMessage(error) })
      throw new Error(`Could not start Apiary on ${host}. Start it there, or log in to its desktop first.`, { cause: error })
    }
    const { startWaitMs = START_WAIT_MS, startPollMs = START_POLL_MS } = this.deps
    const deadline = Date.now() + startWaitMs
    for (;;) {
      if (await this.deps.probe(host) === 'ready') break
      if (Date.now() + startPollMs > deadline) {
        throw new Error(`Apiary started on ${host}, but remote access is off there. Turn on Settings → General → Allow remote access over SSH on that machine.`)
      }
      await new Promise<void>((resolve) => { setTimeout(resolve, startPollMs) })
    }
    await this.connect(host)
  }

  /** On quit: every ssh stops. */
  async dispose(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((s) => this.teardown(s)))
  }

  /** ssh, the forward and the connection; whatever was started is stopped again if a step fails. */
  private async establish(host: string, code: CodeToSend): Promise<Link> {
    let dir: string | null = null
    let tunnel: SshTunnel | null = null
    try {
      const home = await this.homeDirectory(host)
      dir = await this.deps.makeTempDir()
      const local = `${dir}/s`
      tunnel = this.deps.startTunnel(forwardFlags(local, `${home}/.apiary/remote.sock`, this.deps.sshConfig), host, dir)
      await this.waitForSocket(local, tunnel, host)
      const connection = await this.reach(local, host, code)
      return { dir, tunnel, connection }
    } catch (error) {
      await this.cleanup(dir, tunnel)
      throw error
    }
  }

  private watchTunnel(session: Session, link: Link): void {
    void link.tunnel.exited.then(() => {
      if (session.link !== link || link.connection.isClosed) return
      session.lostReason = `The SSH connection to ${session.host} was lost.`
      link.connection.close()
    })
  }

  private async homeDirectory(host: string): Promise<string> {
    let out: string
    try {
      out = await this.deps.exec('ssh', homeDirArgs(host, this.deps.sshConfig), process.cwd())
    } catch (error) {
      // The timeout stops ssh and marks the error's cause `killed`.
      const killed = isRecord(error) && isRecord(error.cause) && error.cause.killed === true
      throw new Error(describeSshFailure(errorMessage(error), host, killed), { cause: error })
    }
    const home = out.trim()
    if (home === '') throw new Error(`${host} did not say where its home directory is.`)
    return home
  }

  private async waitForSocket(path: string, tunnel: SshTunnel, host: string): Promise<void> {
    const { socketWaitMs = SOCKET_WAIT_MS, pollMs = POLL_MS } = this.deps
    let ended = false
    void tunnel.exited.then(() => { ended = true })
    const deadline = Date.now() + socketWaitMs
    while (Date.now() < deadline) {
      if (this.deps.socketExists(path)) return
      if (ended) {
        // ssh may exit just after creating nothing: its stderr says why.
        throw new Error(describeSshFailure(tunnel.stderr(), host))
      }
      await new Promise<void>((resolve) => { setTimeout(resolve, pollMs) })
    }
    await tunnel.stop()
    throw new Error(`${host} did not answer.`)
  }

  /** What to send as the pairing code: the one just typed, else the saved one, else none. */
  private codeFor(host: string, typed: string | undefined): CodeToSend {
    if (typed !== undefined) return { code: typed, saved: false }
    const saved = this.deps.pairingCodes?.get(host) ?? null
    return { code: saved, saved: saved !== null }
  }

  private async reach(socketPath: string, host: string, sent: CodeToSend): Promise<ClientConnection> {
    try {
      return await this.deps.connect(socketPath, { appVersion: this.deps.appVersion, host, ...(sent.code !== null ? { pairing: sent.code } : {}) })
    } catch (error) {
      const message = errorMessage(error)
      const kind = pairingError(message)
      if (kind !== null) {
        // A saved code the work machine no longer accepts is deleted, so the next try asks for it.
        if (kind === 'pairing-wrong' && sent.saved) this.deps.pairingCodes?.forget(host)
        throw new FinalRefusal(pairingErrorMessage(kind, host, this.deps.pairingCodes?.canSave === true), { cause: error })
      }
      // An unreachable socket is retried while reconnecting: mid-session it is usually the work
      // machine's Apiary restarting or quit for a moment, not remote access being turned off. Only
      // the server's own refusal (a version mismatch) will not fix itself.
      if (message.startsWith(UNREACHABLE_PREFIX)) throw new Error(NOT_ACCEPTING(host), { cause: error })
      throw new FinalRefusal(message, { cause: error })
    }
  }

  /** One window per window of the work machine, in number order; one empty window when it has none. */
  private async openRemoteWindows(session: Session): Promise<void> {
    const layouts = [...(await session.link.connection.layouts())].sort((a, b) => a.windowNumber - b.windowNumber)
    const shown: { windowNumber: number; layout?: unknown }[] = layouts.length > 0 ? layouts : [{ windowNumber: 1 }]
    for (const { windowNumber, layout } of shown) {
      const created = this.deps.openWindow(session.host, layout)
      // Synchronously, before the page's first call can arrive: a remote-scope call from this window
      // must already be routed to the work machine rather than answered at home.
      this.deps.windows.bind(created.webContentsId, session.link.connection, windowNumber, session.host)
      session.windows.set(created.webContentsId, windowNumber)
      created.onClosed(() => {
        this.deps.windows.unbind(created.webContentsId)
        session.windows.delete(created.webContentsId)
        if (session.windows.size === 0) fireAndForget(this.teardown(session), 'remote')
      })
    }
  }

  /** Keeps the windows and tries the whole connect again until it works, is refused for good, or no window is left. */
  private async reconnect(session: Session, firstMessage: string): Promise<void> {
    session.reconnecting = true
    const old = session.link
    fireAndForget(this.cleanup(old.dir, old.tunnel), 'remote')
    let message = firstMessage
    for (let attempt = 1; !session.stopped; attempt++) {
      this.sendAll(session, { state: 'reconnecting', host: session.host, message, attempt })
      await this.sleep(session, BACKOFF_MS[attempt - 1] ?? BACKOFF_REPEAT_MS)
      if (session.stopped) return
      log.info('remote', 'reconnect attempt', { host: session.host, attempt })
      try {
        const link = await this.establish(session.host, this.reconnectCode(session))
        if (session.stopped) {
          link.connection.close()
          await this.cleanup(link.dir, link.tunnel)
          return
        }
        session.link = link
        session.reconnecting = false
        this.watchTunnel(session, link)
        for (const [id, w] of session.windows) this.deps.windows.bind(id, link.connection, w, session.host)
        this.sendAll(session, { state: 'connected', host: session.host })
        log.info('remote', 'reconnected', { host: session.host })
        return
      } catch (error) {
        message = errorMessage(error)
        log.warn('remote', 'reconnect failed', { host: session.host, attempt, message })
        if (error instanceof FinalRefusal) {
          this.sessions.delete(session.host)
          session.stopped = true
          this.sendAll(session, { state: 'disconnected', host: session.host, message })
          return
        }
      }
    }
  }

  /** A reconnect sends the saved code, or the one that got in when it could not be saved. */
  private reconnectCode(session: Session): CodeToSend {
    const saved = this.deps.pairingCodes?.get(session.host) ?? null
    return saved !== null ? { code: saved, saved: true } : { code: session.pairing, saved: false }
  }

  private sendAll(session: Session, status: RemoteStatus): void {
    for (const id of session.windows.keys()) this.deps.sendStatus(id, status)
  }

  private sleep(session: Session, ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(done, ms)
      function done(): void { clearTimeout(timer); resolve() }
      session.cancelSleep = done
    })
  }

  private async teardown(session: Session): Promise<void> {
    session.stopped = true
    session.cancelSleep?.()
    if (this.sessions.get(session.host) === session) this.sessions.delete(session.host)
    session.link.connection.close()
    await this.cleanup(session.link.dir, session.link.tunnel)
  }

  private async cleanup(dir: string | null, tunnel: SshTunnel | null): Promise<void> {
    await tunnel?.stop()
    if (dir !== null) await this.deps.removeDir(dir)
  }
}
