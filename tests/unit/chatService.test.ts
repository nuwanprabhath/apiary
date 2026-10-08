import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ChatManager } from '../../src/main/chat/chatManager'
import { ChatService, type ChatServiceDeps } from '../../src/main/chat/chatService'
import { WindowAttachments, type SendTarget } from '../../src/main/windows/windowAttachments'
import type { ChatLifecycle, ChatState } from '@shared/domain/chat'
import { asSessionId } from '@shared/domain/ids'

const A = asSessionId('11111111-1111-4111-8111-111111111111')
const B = asSessionId('22222222-2222-4222-8222-222222222222')

/** A `claude` that starts and stays up until the test ends it with `exit()`. */
function liveChild(): { spawn: () => never; exit: (code?: number) => void } {
  const emitters: EventEmitter[] = []
  const spawn = (): never => {
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
      pid: 4242, kill: vi.fn(() => true),
    })
    emitters.push(child)
    return child as never
  }
  return { spawn, exit: (code = 0) => { for (const c of emitters) c.emit('exit', code, null) } }
}

interface Window extends SendTarget { got: { channel: string; state: ChatState }[] }

function setup(overrides: Partial<ChatServiceDeps> = {}) {
  const child = liveChild()
  const windows = new Map<number, Window>()
  const open = (id: number): Window => {
    const w: Window = {
      got: [],
      isDestroyed: () => false,
      send(channel: string, state?: unknown) { this.got.push({ channel, state: state as ChatState }) },
    }
    windows.set(id, w)
    return w
  }
  const attachments = new WindowAttachments((id) => windows.get(id) ?? null)
  const announced: ChatLifecycle[] = []
  const chats = new ChatManager({
    claudeBin: () => 'claude',
    onChange: (state) => { service.onChanged(state) },
    spawn: child.spawn,
  })
  const pty = {
    has: vi.fn(() => false), killAndWait: vi.fn(async () => {}), screen: vi.fn(() => ''), lastOutputAt: vi.fn(() => 0),
  }
  const store = { getSession: vi.fn(() => null), setImported: vi.fn() }
  const resolver = { requireSession: vi.fn(() => ({ cwd: dir, filePath: join(dir, 'x.jsonl') })) }
  const resume = vi.fn(async () => {})
  const checkConflict = vi.fn(async () => null)
  const deps = {
    chats, pty, resolver, store, attachments, configRoot: dir,
    announce: (c: ChatLifecycle) => { announced.push(c) },
    terminals: { resume },
    catalog: { checkConflict },
    transcripts: { runningBackgroundTasks: async () => 0 },
    ...overrides,
  } as unknown as ChatServiceDeps
  const service = new ChatService(deps)
  return { service, chats, open, attachments, announced, child, pty, store, resolver, resume, checkConflict }
}

let dir = ''
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apiary-chatsvc-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('ChatService delivery', () => {
  it('sends a chat only to the windows that attached its session', async () => {
    const { service, open } = setup()
    const shown = open(1)
    const other = open(2)
    service.attach(1, A)
    await service.start(A, { takeOver: false })
    expect(shown.got.length).toBeGreaterThan(0)
    expect(shown.got.every((g) => g.channel === 'apiary:chat-changed' && g.state.sessionId === A)).toBe(true)
    expect(other.got).toEqual([])
  })

  it('a window still on the session a /clear left follows the chat onto the new one', async () => {
    const { service, open, chats } = setup()
    const stale = open(1)
    service.attach(1, A)
    await service.start(A, { takeOver: false })
    stale.got.length = 0
    service.onChanged({ ...chats.state(A)!, sessionId: B, previousSessionId: A })
    expect(stale.got.map((g) => g.state.sessionId)).toEqual([B])
  })

  it('announces a start, a move and an end to every window, once each, not every state', async () => {
    const { service, announced, chats, child } = setup()
    await service.start(A, { takeOver: false })
    const state = chats.state(A)!
    service.onChanged({ ...state, status: 'busy' })
    service.onChanged({ ...state, status: 'idle' })
    expect(announced).toEqual([{ sessionId: A, previousSessionId: null, running: true }])
    service.onChanged({ ...state, sessionId: B, previousSessionId: A })
    service.onChanged({ ...state, sessionId: B, previousSessionId: A, status: 'busy' })
    expect(announced.at(-1)).toEqual({ sessionId: B, previousSessionId: A, running: true })
    expect(announced).toHaveLength(2)
    child.exit()
    await vi.waitFor(() => { expect(announced.at(-1)).toEqual({ sessionId: A, previousSessionId: null, running: false }) })
  })
})

describe('ChatService lifecycle on stop (B21)', () => {
  const ended = (announced: ChatLifecycle[]): ChatLifecycle[] => announced.filter((a) => !a.running)
  /** Lets the replies that were in flight when the process ended settle (they resolve in microtasks). */
  const settle = async (): Promise<void> => {
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    await new Promise<void>((resolve) => { setImmediate(resolve) })
  }

  it('announces running:false exactly once when a chat is stopped and the process then exits', async () => {
    const { service, announced, child } = setup()
    await service.start(A, { takeOver: false })
    const stopped = service.stop(A)
    child.exit()
    await stopped
    // Late replies to requests that were in flight when the process ended (`initialize`) settle after
    // the exit; once the sweep has forgotten the chat nothing remembers it was already announced.
    await settle()
    expect(ended(announced)).toEqual([{ sessionId: A, previousSessionId: null, running: false }])
  })

  it('a chat started again on the same session announces its own end', async () => {
    const { service, announced, child } = setup()
    for (let run = 0; run < 2; run += 1) {
      await service.start(A, { takeOver: false })
      const stopped = service.stop(A)
      child.exit()
      await stopped
    }
    expect(announced.map((a) => a.running)).toEqual([true, false, true, false])
  })

  it('never emits a state after the one that says the process exited', async () => {
    const { service, chats, child } = setup()
    const states: ChatState[] = []
    await service.start(A, { takeOver: false })
    const spy = vi.spyOn(service, 'onChanged').mockImplementation((s) => { states.push(s) })
    const stopped = service.stop(A)
    child.exit()
    await stopped
    await settle()
    expect(states.filter((s) => s.status === 'exited')).toHaveLength(1)
    expect(states.at(-1)?.status).toBe('exited')
    spy.mockRestore()
    expect(chats.state(A)?.status).toBe('exited')
  })
})

describe('ChatService pruning (ledger B12)', () => {
  it('forgets an exited chat nobody shows', async () => {
    const { service, chats, child } = setup()
    await service.start(A, { takeOver: false })
    child.exit()
    await vi.waitFor(() => { expect(service.state(A)).toBeNull() })
    expect(chats.exitedStates()).toEqual([])
  })

  it('keeps an exited chat available to the window showing it, and forgets it when that window lets go', async () => {
    const { service, open, child } = setup()
    const shown = open(1)
    service.attach(1, A)
    await service.start(A, { takeOver: false })
    child.exit()
    await vi.waitFor(() => { expect(shown.got.at(-1)?.state.status).toBe('exited') })
    // A reload of that window asks again: the last state is still there.
    expect(service.state(A)?.status).toBe('exited')
    service.detach(1, A)
    expect(service.state(A)).toBeNull()
  })

  it('a window that closes counts as letting go', async () => {
    const { service, open, child } = setup()
    open(1)
    service.attach(1, A)
    await service.start(A, { takeOver: false })
    child.exit()
    await vi.waitFor(() => { expect(service.state(A)?.status).toBe('exited') })
    service.detachWindow(1)
    expect(service.state(A)).toBeNull()
  })

  it('a running chat is never forgotten, whoever lets go', async () => {
    const { service, open } = setup()
    open(1)
    service.attach(1, A)
    await service.start(A, { takeOver: false })
    service.detach(1, A)
    expect(service.state(A)?.status).not.toBe('exited')
  })
})

describe('ChatService.start', () => {
  it('refuses a session running in its terminal unless the caller takes it over', async () => {
    const { service, pty } = setup()
    pty.has.mockReturnValue(true)
    await expect(service.start(A, { takeOver: false })).rejects.toThrow('running in its terminal')
    expect(pty.killAndWait).not.toHaveBeenCalled()
    await service.start(A, { takeOver: true })
    expect(pty.killAndWait).toHaveBeenCalledWith(A)
  })

  it('says so when the session folder is gone', async () => {
    const { service, resolver } = setup()
    resolver.requireSession.mockReturnValue({ cwd: join(dir, 'gone'), filePath: '' })
    await expect(service.start(A, { takeOver: false })).rejects.toThrow('no longer exists')
  })

  it('returns the chat already running instead of starting a second', async () => {
    const { service } = setup()
    const first = await service.start(A, { takeOver: false })
    const again = await service.start(A, { takeOver: true })
    expect(again.sessionId).toBe(first.sessionId)
  })
})

describe('ChatService and the terminal', () => {
  it('stops a running chat before the session opens in a terminal, and is no conflict', async () => {
    const { service, chats, resume, checkConflict } = setup()
    await service.start(A, { takeOver: false })
    expect(await service.checkConflict(A)).toBeNull()
    expect(checkConflict).not.toHaveBeenCalled()
    const stop = vi.spyOn(chats, 'stop').mockResolvedValue()
    await service.resumeInTerminal(A)
    expect(stop).toHaveBeenCalledWith(A)
    expect(resume).toHaveBeenCalledWith(A)
  })

  it('adopts a session a chat moved onto once its file is in the store, and only once', async () => {
    const { service, chats, store } = setup()
    await service.start(A, { takeOver: false })
    service.onChanged({ ...chats.state(A)!, sessionId: B, previousSessionId: A })
    service.adoptSessions()
    expect(store.setImported).not.toHaveBeenCalled() // not scanned yet
    store.getSession.mockReturnValue({} as never)
    service.adoptSessions()
    service.onChanged({ ...chats.state(A)!, sessionId: B, previousSessionId: A })
    service.adoptSessions()
    expect(store.setImported).toHaveBeenCalledTimes(1)
    expect(store.setImported).toHaveBeenCalledWith([B], true)
  })
})
