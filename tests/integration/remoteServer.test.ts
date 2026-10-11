import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { connect, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IPC, type IpcKey } from '@shared/ipc/contract'
import type { RemoteClientInfo } from '@shared/domain/remote'
import { log } from '../../src/main/log/logger'
import { terminalRef } from '@shared/domain/ids'
import { SessionResolver } from '../../src/main/sessions/sessionResolver'
import { VsCodeService } from '../../src/main/vscode/vscodeService'
import type { SessionStore } from '../../src/main/store/sessionStore'
import type { PtyManager } from '../../src/main/pty/ptyManager'
import type { ThemeState } from '@shared/api'
import { encodeFrame, FrameDecoder } from '../../src/main/remote/frames'
import { contractHash, PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from '../../src/main/remote/protocol'
import { RemoteServer, type RemoteServerDeps } from '../../src/main/remote/remoteServer'
import { VirtualContentsRegistry } from '../../src/main/remote/virtualContents'
import { createDispatcher, type Handlers, type Listeners } from '../../src/main/ipc/registrar'
import { WindowAttachments } from '../../src/main/windows/windowAttachments'
import { broadcast, registerBroadcastTargets } from '../../src/main/windows/broadcast'

vi.mock('electron', () => ({
  ipcMain: { handle: () => {}, on: () => {}, removeHandler: () => {}, removeAllListeners: () => {} },
  BrowserWindow: { getAllWindows: () => [] },
}))

const VERSION = '1.36.0'

/** A client written to the protocol: frames in, frames out. */
class Client {
  readonly messages: ServerMessage[] = []
  closed = false
  private readonly decoder = new FrameDecoder()
  private constructor(private readonly socket: Socket) {
    socket.on('data', (chunk: Buffer) => { this.messages.push(...(this.decoder.push(chunk) as ServerMessage[])) })
    socket.on('close', () => { this.closed = true })
    socket.on('error', () => {})
  }

  static async open(path: string): Promise<Client> {
    const socket = connect(path)
    await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject) })
    return new Client(socket)
  }

  send(message: ClientMessage): void { this.socket.write(encodeFrame(message)) }
  hello(over: Partial<Extract<ClientMessage, { t: 'hello' }>> = {}): void {
    this.send({ t: 'hello', protocol: PROTOCOL_VERSION, contract: contractHash(), appVersion: VERSION, ...over })
  }

  async next(match: (m: ServerMessage) => boolean): Promise<ServerMessage> {
    return vi.waitFor(() => {
      const found = this.messages.find(match)
      if (found === undefined) throw new Error('not yet')
      return found
    })
  }

  result(id: number): Promise<ServerMessage> { return this.next((m) => m.t === 'result' && m.id === id) }
  end(): void { this.socket.destroy() }
}

describe('RemoteServer', () => {
  let home: string
  let registry: VirtualContentsRegistry
  let attachments: WindowAttachments
  let server: RemoteServer
  let clients: Client[]
  let disposeTargets: () => void

  async function boot(helloTimeoutMs = 5000, extra: Partial<RemoteServerDeps> = {}): Promise<void> {
    registry = new VirtualContentsRegistry()
    attachments = new WindowAttachments((id) => registry.get(id))
    const handlers: Partial<Handlers> = {
      activeTabs: () => [],
      focusTab: () => {},
      checkConflict: () => { throw new Error('boom: it broke') },
      settingsSet: () => { throw new Error('a local handler must never run remotely') },
    }
    const listeners: Partial<Listeners> = {
      ptyAttach: (e, id) => { attachments.attach(e.sender.id, id) },
    }
    server = new RemoteServer({
      homeDir: home, host: 'work-box', appVersion: VERSION, registry, layouts: () => [], helloTimeoutMs, ...extra,
    })
    server.attachDispatcher(createDispatcher(handlers, listeners))
    disposeTargets = registerBroadcastTargets(() => registry.list())
    await server.start()
  }

  async function client(): Promise<Client> {
    const c = await Client.open(server.socketPath)
    clients.push(c)
    return c
  }

  async function greeted(): Promise<Client> {
    const c = await client()
    c.hello()
    await c.next((m) => m.t === 'welcome')
    return c
  }

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'apiary-remote-'))
    clients = []
  })
  afterEach(async () => {
    for (const c of clients) c.end()
    disposeTargets()
    await server.stop()
    rmSync(home, { recursive: true, force: true })
  })

  it('welcomes a matching hello with the host name and version', async () => {
    await boot()
    const c = await client()
    c.hello()
    expect(await c.next((m) => m.t === 'welcome')).toEqual({ t: 'welcome', host: 'work-box', appVersion: VERSION })
  })

  it('refuses a version or contract mismatch, naming both versions, and closes', async () => {
    await boot()
    const a = await client()
    a.hello({ appVersion: '1.37.0' })
    expect(await a.next((m) => m.t === 'refused')).toEqual({
      t: 'refused', message: 'work-box runs Apiary 1.36.0; this machine runs 1.37.0. Update one of them.', reason: 'version',
    })
    await vi.waitFor(() => { expect(a.closed).toBe(true) })

    const b = await client()
    b.hello({ contract: 'different' })
    await b.next((m) => m.t === 'refused')
    await vi.waitFor(() => { expect(b.closed).toBe(true) })
  })

  it('closes a connection that sends no hello in time', async () => {
    await boot(50)
    const c = await client()
    await vi.waitFor(() => { expect(c.closed).toBe(true) })
    expect(c.messages).toEqual([])
  })

  it('refuses a local-scoped key and an unknown key, and runs neither', async () => {
    await boot()
    const c = await greeted()
    c.send({ t: 'open', w: 1 })
    c.send({ t: 'invoke', id: 1, w: 1, key: 'settingsSet', args: [{}] })
    c.send({ t: 'invoke', id: 2, w: 1, key: 'nonsense' as string as IpcKey, args: [] })
    expect(await c.result(1)).toEqual({ t: 'result', id: 1, ok: false, message: 'Not allowed remotely' })
    expect(await c.result(2)).toEqual({ t: 'result', id: 2, ok: false, message: 'Not allowed remotely' })
  })

  describe('resolve', () => {
    const terminal = terminalRef('new:1', true)
    let dir: string
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'apiary-resolve-'))
      writeFileSync(join(dir, 'notes.md'), 'x')
    })
    afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

    async function bootResolving(): Promise<Client> {
      const pty = { getCwd: () => dir } as unknown as PtyManager
      await boot(5000, { vscode: new VsCodeService({ resolver: new SessionResolver({ store: {} as SessionStore, pty }), vsCodePath: null }) })
      const c = await greeted()
      c.send({ t: 'open', w: 1 })
      return c
    }
    const answer = async (c: Client, id: number): Promise<ServerMessage> => c.next((m) => m.t === 'resolved' && m.id === id)

    it('answers the folder of a session and the file a mention names, with its line', async () => {
      const c = await bootResolving()
      c.send({ t: 'resolve', id: 1, w: 1, what: 'session-folder', terminal })
      c.send({ t: 'resolve', id: 2, w: 1, what: 'mentioned-file', terminal, mention: 'notes.md:4' })
      expect(await answer(c, 1)).toEqual({ t: 'resolved', id: 1, ok: true, path: dir })
      expect(await answer(c, 2)).toEqual({ t: 'resolved', id: 2, ok: true, path: expect.stringMatching(/notes\.md$/) as string, line: 4 })
    })

    it('refuses a mention outside the session folder and bad arguments', async () => {
      const c = await bootResolving()
      c.send({ t: 'resolve', id: 1, w: 1, what: 'mentioned-file', terminal, mention: '../../etc/hosts' })
      c.send({ t: 'resolve', id: 2, w: 1, what: 'mentioned-file', terminal, mention: 7 as never })
      c.send({ t: 'resolve', id: 3, w: 1, what: 'session-folder', terminal: 42 as never })
      expect(await answer(c, 1)).toMatchObject({ ok: false, message: expect.stringContaining('not a file') as string })
      expect(await answer(c, 2)).toEqual({ t: 'resolved', id: 2, ok: false, message: 'Invalid request.' })
      expect(await answer(c, 3)).toEqual({ t: 'resolved', id: 3, ok: false, message: 'Invalid request.' })
    })

    it('still refuses a plain invoke of openInVsCode and openMentionedFile', async () => {
      const c = await bootResolving()
      c.send({ t: 'invoke', id: 1, w: 1, key: 'openInVsCode', args: [terminal] })
      c.send({ t: 'invoke', id: 2, w: 1, key: 'openMentionedFile', args: [terminal, 'notes.md'] })
      expect(await c.result(1)).toEqual({ t: 'result', id: 1, ok: false, message: 'Not allowed remotely' })
      expect(await c.result(2)).toEqual({ t: 'result', id: 2, ok: false, message: 'Not allowed remotely' })
    })
  })

  it('refuses bad arguments with the contract guard', async () => {
    await boot()
    const c = await greeted()
    c.send({ t: 'open', w: 1 })
    c.send({ t: 'invoke', id: 1, w: 1, key: 'focusTab', args: [42] })
    expect(await c.result(1)).toEqual({ t: 'result', id: 1, ok: false, message: 'Invalid request.' })
  })

  it('returns a handler value, and a thrown error as its message without a stack', async () => {
    await boot()
    const c = await greeted()
    c.send({ t: 'open', w: 1 })
    c.send({ t: 'invoke', id: 1, w: 1, key: 'activeTabs', args: [] })
    c.send({ t: 'invoke', id: 2, w: 1, key: 'checkConflict', args: ['s1'] })
    expect(await c.result(1)).toEqual({ t: 'result', id: 1, ok: true, value: [] })
    expect(await c.result(2)).toEqual({ t: 'result', id: 2, ok: false, message: 'boom: it broke' })
  })

  it('sends ptyData only to the window that attached the pty', async () => {
    await boot()
    const c = await greeted()
    c.send({ t: 'open', w: 1 })
    c.send({ t: 'open', w: 2 })
    c.send({ t: 'send', w: 1, key: 'ptyAttach', args: ['pty-a'] })
    await vi.waitFor(() => { expect(attachments.isAttached('pty-a')).toBe(true) })
    attachments.sendTo('pty-a', IPC.ptyData, 'pty-a', 'hello')
    const event = await c.next((m) => m.t === 'event')
    expect(event).toEqual({ t: 'event', w: 1, channel: IPC.ptyData.channel, args: ['pty-a', 'hello'] })
    expect(c.messages.filter((m) => m.t === 'event')).toHaveLength(1)
  })

  it('broadcasts a remote-scoped event to every window and a local-scoped one to none', async () => {
    await boot()
    const c = await greeted()
    c.send({ t: 'open', w: 1 })
    c.send({ t: 'open', w: 2 })
    await vi.waitFor(() => { expect(registry.list()).toHaveLength(2) })
    broadcast(IPC.themeChanged, {} as ThemeState)
    broadcast(IPC.treeChanged)
    await vi.waitFor(() => { expect(c.messages.filter((m) => m.t === 'event')).toHaveLength(2) })
    expect(c.messages.filter((m) => m.t === 'event').map((m) => m.t === 'event' ? [m.w, m.channel] : [])).toEqual([
      [1, IPC.treeChanged.channel], [2, IPC.treeChanged.channel],
    ])
  })

  it('destroys a connection\'s windows and detaches them when it ends', async () => {
    await boot()
    const c = await greeted()
    c.send({ t: 'open', w: 1 })
    c.send({ t: 'send', w: 1, key: 'ptyAttach', args: ['pty-a'] })
    await vi.waitFor(() => { expect(attachments.isAttached('pty-a')).toBe(true) })
    const [win] = registry.list()
    c.end()
    await vi.waitFor(() => { expect(registry.list()).toEqual([]) })
    expect(win?.isDestroyed()).toBe(true)
    attachments.sendTo('pty-a', IPC.ptyData, 'pty-a', 'late')
    expect(attachments.isAttached('pty-a')).toBe(false)
  })

  it('makes the directory 0700 and the socket 0600, and replaces a stale socket file', async () => {
    mkdirSync(join(home, '.apiary'), { mode: 0o755 })
    writeFileSync(join(home, '.apiary', 'remote.sock'), 'stale')
    await boot()
    expect(statSync(join(home, '.apiary')).mode & 0o777).toBe(0o700)
    expect(statSync(server.socketPath).mode & 0o777).toBe(0o600)
    expect(statSync(server.socketPath).isSocket()).toBe(true)
    await greeted()
  })

  it('stop closes live connections and removes the socket', async () => {
    await boot()
    const c = await greeted()
    c.send({ t: 'open', w: 1 })
    await vi.waitFor(() => { expect(registry.list()).toHaveLength(1) })
    await server.stop()
    await vi.waitFor(() => { expect(c.closed).toBe(true) })
    expect(existsSync(server.socketPath)).toBe(false)
    expect(registry.list()).toEqual([])
  })

  describe('who is connected', () => {
    it('lists a client from its hello and drops it on close, with an event each time', async () => {
      await boot()
      const heard: RemoteClientInfo[][] = []
      server.subscribe((list) => { heard.push(list) })
      const a = await client()
      a.hello({ client: 'home-mac' })
      await a.next((m) => m.t === 'welcome')
      expect(server.clients()).toMatchObject([{ client: 'home-mac', windows: 0 }])
      expect(typeof server.clients()[0]?.connectedAt).toBe('number')
      const b = await client()
      b.hello({ client: 'laptop' })
      await b.next((m) => m.t === 'welcome')
      expect(server.clients().map((c) => c.client)).toEqual(['home-mac', 'laptop'])
      a.send({ t: 'open', w: 1 })
      await vi.waitFor(() => { expect(server.clients()[0]?.windows).toBe(1) })
      a.end()
      await vi.waitFor(() => { expect(server.clients().map((c) => c.client)).toEqual(['laptop']) })
      b.end()
      await vi.waitFor(() => { expect(server.clients()).toEqual([]) })
      expect(heard.map((l) => l.length)).toEqual([1, 2, 2, 1, 0])
    })

    it('does not list a client that was refused, and names one that sent no name', async () => {
      await boot()
      const bad = await client()
      bad.hello({ appVersion: '9.9.9', client: 'stranger' })
      await bad.next((m) => m.t === 'refused')
      const anon = await greeted()
      expect(server.clients().map((c) => c.client)).toEqual(['a remote machine'])
      anon.end()
    })

    it('Disconnect all closes every connection and turns remote access off', async () => {
      const turnOff = vi.fn()
      await boot(5000, { turnOff })
      const a = await greeted()
      const b = await greeted()
      server.disconnectAll()
      await vi.waitFor(() => { expect(a.closed && b.closed).toBe(true) })
      expect(turnOff).toHaveBeenCalledTimes(1)
      await vi.waitFor(() => { expect(server.clients()).toEqual([]) })
    })
  })

  describe('the pairing code', () => {
    const CODE = 'KMNP2345'
    const pairing = { required: () => true, code: () => CODE }

    it('is required, then refused when missing or wrong, then accepted when right', async () => {
      await boot(5000, { pairing })
      const missing = await client()
      missing.hello()
      expect(await missing.next((m) => m.t === 'refused')).toMatchObject({ t: 'refused', reason: 'pairing-required' })
      const wrong = await client()
      wrong.hello({ pairing: 'WXYZ-6789' })
      expect(await wrong.next((m) => m.t === 'refused')).toMatchObject({ t: 'refused', reason: 'pairing-wrong' })
      expect(server.clients()).toEqual([])
      const right = await client()
      right.hello({ pairing: 'kmnp-2345' })
      expect(await right.next((m) => m.t === 'welcome')).toMatchObject({ t: 'welcome', host: 'work-box' })
      expect(server.clients()).toHaveLength(1)
    })

    it('asks for nothing while the setting is off', async () => {
      await boot(5000, { pairing: { required: () => false, code: () => CODE } })
      await greeted()
      expect(server.clients()).toHaveLength(1)
    })

    it('refuses everything for a minute after 5 wrong codes, then accepts a right one again', async () => {
      let now = 1_000_000
      await boot(5000, { pairing, now: () => now })
      const reasons: unknown[] = []
      for (let i = 0; i < 6; i++) {
        const c = await client()
        c.hello({ pairing: 'WXYZ6789' })
        const refused = await c.next((m) => m.t === 'refused')
        reasons.push(refused.t === 'refused' ? refused.reason : null)
        now += 1000
      }
      expect(reasons).toEqual(['pairing-wrong', 'pairing-wrong', 'pairing-wrong', 'pairing-wrong', 'pairing-wrong', 'rate-limited'])
      const during = await client()
      during.hello({ pairing: CODE })
      expect(await during.next((m) => m.t === 'refused')).toMatchObject({ reason: 'rate-limited' })
      now += 61_000
      const after = await client()
      after.hello({ pairing: CODE })
      expect(await after.next((m) => m.t === 'welcome')).toMatchObject({ t: 'welcome' })
    })

    it('never writes the code, right or wrong, to the log', async () => {
      const lines: string[] = []
      const capture = (...args: unknown[]): void => { lines.push(JSON.stringify(args)) }
      const spies = (['debug', 'info', 'warn', 'error'] as const).map((level) => vi.spyOn(log, level).mockImplementation(capture))
      try {
        await boot(5000, { pairing })
        const wrong = await client()
        wrong.hello({ pairing: 'WXYZ6789' })
        await wrong.next((m) => m.t === 'refused')
        const right = await client()
        right.hello({ pairing: CODE })
        await right.next((m) => m.t === 'welcome')
        expect(lines.length).toBeGreaterThan(0)
        for (const line of lines) {
          expect(line).not.toContain(CODE)
          expect(line).not.toContain('WXYZ6789')
        }
      } finally {
        for (const spy of spies) spy.mockRestore()
      }
    })
  })
})
