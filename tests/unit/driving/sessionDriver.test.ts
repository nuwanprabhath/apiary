import { describe, it, expect, vi } from 'vitest'
import { emptyChatState, type ChatPermissionRequest, type ChatState } from '@shared/domain/chat'
import type { WorktreeCreateRequest } from '@shared/domain/git'
import { asSessionId, type SessionId } from '@shared/domain/ids'
import { SessionDriver, type FolderSource, type SessionEvent } from '../../../src/main/driving/sessionDriver'

const S = asSessionId('11111111-1111-4111-8111-111111111111')
const NEW = asSessionId('33333333-3333-4333-8333-333333333333')
const MOVED = asSessionId('22222222-2222-4222-8222-222222222222')
const REPO: FolderSource = { path: '/secret/place/repo', name: 'repo', branch: 'main', isRepo: true, worktreeOf: null }

const asked = (id: string): ChatPermissionRequest => ({ requestId: id, toolName: 'Bash', description: '', input: {}, canAlwaysAllow: false })
const assistantSaying = (text: string): ChatState['live'][number] => ({
  uuid: text, role: 'assistant', timestampMs: null, isSidechain: false, blocks: [{ type: 'text', text }],
})

function setup(opts: { known?: SessionId[]; terminalBusy?: () => boolean } = {}) {
  let now = 1_000_000
  const sleepers: { at: number; resolve: () => void }[] = []
  const known = new Set<SessionId>(opts.known ?? [S])
  const states = new Map<SessionId, ChatState>()
  const listeners = new Set<(s: ChatState) => void>()
  const chat = {
    state: vi.fn((id: SessionId) => states.get(id) ?? null),
    start: vi.fn(async (id: SessionId) => { const state = { ...emptyChatState(id), status: 'idle' as const }; states.set(id, state); return state }),
    startNew: vi.fn(async () => { known.add(NEW); const state = { ...emptyChatState(NEW), status: 'idle' as const }; states.set(NEW, state); return state }),
    send: vi.fn(), interrupt: vi.fn(), respond: vi.fn(),
    terminalBusy: vi.fn(async () => ({ busy: opts.terminalBusy?.() ?? false, backgroundTasks: 0 })),
    onState: vi.fn((l: (s: ChatState) => void) => { listeners.add(l); return () => { listeners.delete(l) } }),
  }
  const deps = {
    chat,
    session: (id: SessionId) => (known.has(id) ? { title: `title ${id.slice(0, 2)}` } : null),
    folders: () => [REPO],
    createWorktree: vi.fn(async (_p: string, _r: WorktreeCreateRequest) => '/secret/place/repo-wt'),
    describeFolder: (path: string, repoName: string): FolderSource => ({ path, name: 'repo-wt', branch: null, isRepo: true, worktreeOf: repoName }),
    openSession: vi.fn(), refresh: vi.fn(async () => {}),
    now: () => now,
    sleep: (ms: number) => new Promise<void>((resolve) => { sleepers.push({ at: now + ms, resolve }) }),
  }
  const driver = new SessionDriver(deps)
  const events: SessionEvent[] = []
  driver.onEvent((e) => events.push(e))
  const flush = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve() }
  const advance = async (ms: number): Promise<void> => {
    now += ms
    for (const s of sleepers.splice(0).filter((x) => x.at <= now || (sleepers.push(x), false))) s.resolve()
    await flush()
  }
  const push = (id: SessionId, patch: Partial<ChatState>): void => {
    const next = { ...(states.get(id) ?? emptyChatState(id)), ...patch }
    states.set(id, next)
    for (const l of [...listeners]) l(next)
  }
  return { driver, chat, deps, events, push, advance, flush, known, states }
}

describe('SessionDriver', () => {
  it('lists folders by an opaque id and never a path', () => {
    const { driver } = setup()
    const [folder] = driver.folders()
    expect(folder?.id).toMatch(/^[0-9a-f]{12}$/)
    expect(JSON.stringify(driver.folders())).not.toContain('/secret')
  })

  it('sends into a running chat and opens its tab', async () => {
    const { driver, chat, deps, push } = setup()
    push(S, { status: 'busy' })
    expect(await driver.send(S, 'hello')).toBe('sent')
    expect(chat.send).toHaveBeenCalledWith(S, 'hello')
    expect(chat.start).not.toHaveBeenCalled()
    expect(deps.openSession).toHaveBeenCalledWith(S)
  })

  it('starts the chat of a closed session, then sends', async () => {
    const { driver, chat } = setup()
    expect(await driver.send(S, 'hello')).toBe('sent')
    expect(chat.start).toHaveBeenCalledWith(S, { takeOver: true })
    expect(chat.send).toHaveBeenCalledWith(S, 'hello')
  })

  it('waits for a busy terminal, takes it over when its turn ends, then sends and reports delivered', async () => {
    let busy = true
    const { driver, chat, events, advance } = setup({ terminalBusy: () => busy })
    expect(await driver.send(S, 'later')).toBe('waiting')
    await advance(5000)
    expect(chat.start).not.toHaveBeenCalled()
    busy = false
    await advance(5000)
    expect(chat.start).toHaveBeenCalledWith(S, { takeOver: true })
    expect(chat.send).toHaveBeenCalledWith(S, 'later')
    expect(events).toEqual([{ kind: 'delivered', sessionId: S, title: 'title 11' }])
  })

  it('gives up on a terminal still busy after 30 minutes with a stopped event', async () => {
    const { driver, chat, events, advance } = setup({ terminalBusy: () => true })
    await driver.send(S, 'later')
    for (let i = 0; i < 361; i++) await advance(5000)
    expect(chat.send).not.toHaveBeenCalled()
    expect(events).toEqual([{ kind: 'stopped', sessionId: S, title: 'title 11', reason: 'Its terminal was still busy after 30 minutes.' }])
  })

  it('an unknown session id is an error naming it', async () => {
    const { driver } = setup()
    await expect(driver.send(MOVED, 'x')).rejects.toThrow(MOVED)
    expect(() => { driver.watch(MOVED) }).toThrow(MOVED)
  })

  it('a watched chat going from busy to idle reports the turn\'s final text, cut at 6000', async () => {
    const { driver, events, push } = setup()
    driver.watch(S)
    push(S, { status: 'busy' })
    push(S, { status: 'idle', live: [assistantSaying('x'.repeat(7000))] })
    expect(events).toHaveLength(1)
    const event = events[0]
    expect(event?.kind === 'turn-ended' && event.text.length).toBe(6000)
    expect(event?.kind === 'turn-ended' && event.text.endsWith('…')).toBe(true)
    expect(event?.kind === 'turn-ended' && event.interrupted).toBe(false)
  })

  it('a turn the driver interrupted says so', () => {
    const { driver, chat, events, push } = setup()
    driver.watch(S)
    push(S, { status: 'busy' })
    driver.interrupt(S)
    expect(chat.interrupt).toHaveBeenCalledWith(S)
    push(S, { status: 'idle' })
    expect(events[0]).toMatchObject({ kind: 'turn-ended', interrupted: true, text: '' })
  })

  it('an unwatched session reports nothing', () => {
    const { driver, events, push } = setup()
    driver.watch(S)
    driver.unwatch(S)
    push(S, { status: 'busy' })
    push(S, { status: 'idle' })
    push(S, { status: 'exited', error: 'boom' })
    expect(events).toEqual([])
  })

  it('a permission request is reported once, and its going away only when the driver did not answer it', () => {
    const { driver, chat, events, push } = setup()
    driver.watch(S)
    push(S, { status: 'busy', permissions: [asked('a')] })
    push(S, { status: 'busy', permissions: [asked('a')] })
    expect(events.filter((e) => e.kind === 'permission')).toHaveLength(1)
    expect(driver.stateOf(S).status).toBe('waiting')
    driver.answer(S, 'a', { behavior: 'allow' })
    expect(chat.respond).toHaveBeenCalledWith(S, 'a', { behavior: 'allow' })
    push(S, { status: 'busy', permissions: [] })
    expect(events.some((e) => e.kind === 'permission-gone')).toBe(false)
    push(S, { status: 'busy', permissions: [asked('b')] })
    push(S, { status: 'busy', permissions: [] })
    expect(events.at(-1)).toEqual({ kind: 'permission-gone', sessionId: S, requestId: 'b' })
  })

  it('a chat that exits reports stopped with its error', () => {
    const { driver, events, push } = setup()
    driver.watch(S)
    push(S, { status: 'exited', error: 'fell over' })
    expect(events).toEqual([{ kind: 'stopped', sessionId: S, title: 'title 11', reason: 'fell over' }])
    expect(driver.stateOf(S).status).toBe('stopped')
  })

  it('a chat that moves to a new session stays watched under the new id', () => {
    const { driver, events, push, known } = setup()
    known.add(MOVED)
    driver.watch(S)
    push(S, { status: 'busy' })
    push(MOVED, { status: 'busy', previousSessionId: S })
    expect(events).toEqual([{ kind: 'moved', sessionId: MOVED, from: S }])
    expect(driver.watched()).toEqual([MOVED])
    push(MOVED, { status: 'idle', previousSessionId: S })
    expect(events.at(-1)).toMatchObject({ kind: 'turn-ended', sessionId: MOVED })
  })

  it('starting a session in a new worktree creates it with the dialog\'s request and sends the first message', async () => {
    const { driver, chat, deps } = setup()
    const request: WorktreeCreateRequest = { name: 'feature', branch: { kind: 'new', branch: 'feature' } }
    const [folder] = driver.folders()
    const started = await driver.startSession(folder!.id, 'do it', request)
    expect(deps.createWorktree).toHaveBeenCalledWith('/secret/place/repo', request)
    expect(chat.startNew).toHaveBeenCalledWith('/secret/place/repo-wt')
    expect(chat.send).toHaveBeenCalledWith(NEW, 'do it')
    expect(started.sessionId).toBe(NEW)
    expect(started.folder).toMatchObject({ name: 'repo-wt', worktreeOf: 'repo' })
    expect(JSON.stringify(started)).not.toContain('/secret')
    expect(deps.openSession).toHaveBeenCalledWith(NEW)
  })

  it('a new session is watched from its first message, so a first turn that ends before the store knows it is still reported', async () => {
    const { driver, chat, events, push, known, advance } = setup()
    chat.startNew.mockImplementationOnce(async () => {
      const state = { ...emptyChatState(NEW), status: 'idle' as const }
      push(NEW, state)
      return state
    })
    const [folder] = driver.folders()
    const started = driver.startSession(folder!.id, 'quick one')
    await advance(0)
    push(NEW, { status: 'busy' })
    push(NEW, { status: 'idle', live: [assistantSaying('done already')] })
    known.add(NEW)
    await advance(1000)
    await started
    expect(events.find((e) => e.kind === 'turn-ended')).toMatchObject({ sessionId: NEW, text: 'done already' })
    expect(driver.watched()).toContain(NEW)
  })

  it('an unknown folder id is an error', async () => {
    const { driver } = setup()
    await expect(driver.startSession('deadbeef0000', 'x')).rejects.toThrow('deadbeef0000')
  })
})
