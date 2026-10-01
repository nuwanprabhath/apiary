import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { ChatManager } from '../../src/main/chat/chatManager'
import type { ChatState } from '../../src/shared/domain/chat'

/**
 * The real ChatManager — a login shell running "claude" with the chat flags — against
 * tests/fixtures/fake-claude-chat.mjs, which speaks the same stream-json protocol as claude 2.1.286.
 */
const FAKE = resolve(__dirname, '../fixtures/fake-claude-chat.mjs')
const SESSION = '11111111-2222-3333-4444-555555555555'

let manager: ChatManager | null = null
let dir: string | null = null
afterEach(async () => {
  await manager?.stopAll()
  if (dir !== null) rmSync(dir, { recursive: true, force: true })
  manager = null
  dir = null
})

function start(): { states: ChatState[]; until: (pred: (s: ChatState) => boolean) => Promise<ChatState> } {
  dir = mkdtempSync(join(tmpdir(), 'apiary-chat-'))
  const states: ChatState[] = []
  const waiters: { pred: (s: ChatState) => boolean; resolve: (s: ChatState) => void }[] = []
  manager = new ChatManager({
    claudeBin: () => FAKE,
    onChange: (s) => {
      states.push(s)
      for (const w of [...waiters]) if (w.pred(s)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(s) }
    },
  })
  manager.start(SESSION, dir)
  const until = (pred: (s: ChatState) => boolean): Promise<ChatState> => {
    const last = states[states.length - 1]
    if (last !== undefined && pred(last)) return Promise.resolve(last)
    return new Promise((r) => waiters.push({ pred, resolve: r }))
  }
  return { states, until }
}

const textOf = (s: ChatState): string[] =>
  s.live.flatMap((m) => m.blocks).map((b) => (b.type === 'text' ? b.text : b.type === 'tool_result' ? b.content : ''))

describe('ChatManager', () => {
  it('sends a message and streams the reply into live messages, ending idle', async () => {
    const { states, until } = start()
    manager!.send(SESSION, 'hello there')
    const done = await until((s) => s.status === 'idle' && s.live.length >= 2)
    expect(textOf(done)).toEqual(['hello there', 'You said: hello there'])
    expect(done.model).toBe('claude-fake-1')
    expect(done.contextWindow).toBe(200000)
    // The reply was seen being written before it was whole.
    expect(states.some((s) => (s.streaming?.text ?? '').startsWith('You said'))).toBe(true)
  }, 20000)

  it('asks for permission, and runs the tool once it is allowed', async () => {
    const { until } = start()
    manager!.send(SESSION, 'this needs permission')
    const asking = await until((s) => s.permissions.length === 1)
    expect(asking.permissions[0]).toMatchObject({ toolName: 'Bash', description: 'Print a marker', canAlwaysAllow: true })
    manager!.respond(SESSION, asking.permissions[0].requestId, { behavior: 'allow' })
    const done = await until((s) => s.status === 'idle' && textOf(s).includes('The command ran.'))
    expect(done.permissions).toEqual([])
    expect(textOf(done)).toContain('fake-ran')
  }, 20000)

  it('a denied tool is not run, and Claude is told', async () => {
    const { until } = start()
    manager!.send(SESSION, 'permission please')
    const asking = await until((s) => s.permissions.length === 1)
    manager!.respond(SESSION, asking.permissions[0].requestId, { behavior: 'deny', message: 'not now' })
    const done = await until((s) => s.status === 'idle' && textOf(s).includes('Understood, I did not run it.'))
    expect(textOf(done)).toContain('not now')
  }, 20000)

  it('stops a reply part-way when interrupted', async () => {
    const { until } = start()
    manager!.send(SESSION, 'go slow')
    await until((s) => (s.streaming?.text ?? '').length > 0)
    manager!.interrupt(SESSION)
    const done = await until((s) => s.status === 'idle')
    expect(textOf(done)).toContain('[Request interrupted by user]')
  }, 20000)

  it('a message sent while Claude is still answering keeps the chat busy until both are answered', async () => {
    const { states, until } = start()
    manager!.send(SESSION, 'first')
    await until((s) => (s.streaming?.text ?? '') !== '')
    manager!.send(SESSION, 'second')
    const done = await until((s) => s.status === 'idle' && textOf(s).includes('You said: second'))
    expect(textOf(done)).toContain('You said: first')
    // Between the first answer and the second, it never looked finished.
    const firstAnswered = states.findIndex((s) => textOf(s).includes('You said: first'))
    const secondAnswered = states.findIndex((s) => textOf(s).includes('You said: second'))
    expect(states.slice(firstAnswered, secondAnswered).every((s) => s.status === 'busy')).toBe(true)
  }, 20000)

  it('stopping ends the process cleanly, with no error', async () => {
    const { until } = start()
    manager!.send(SESSION, 'hi')
    await until((s) => s.status === 'idle' && s.live.length >= 2)
    await manager!.stop(SESSION)
    const stopped = await until((s) => s.status === 'exited')
    expect(stopped.error).toBeNull()
    expect(manager!.has(SESSION)).toBe(false)
  }, 20000)
})

describe('ChatManager: model and effort', () => {
  it('knows claude\'s model list, the model really running and its effort, and changes both', async () => {
    const { until } = start()
    const listed = await until((s) => s.models !== null)
    expect(listed.models!.map((m) => m.displayName)).toEqual(['Default (recommended)', 'Fake 1', 'Fast 2'])
    expect(listed.models![2].efforts).toEqual([])
    manager!.send(SESSION, 'hi')
    await until((s) => s.model === 'claude-fake-1' && s.effort === 'medium')
    manager!.setEffort(SESSION, 'high')
    await until((s) => s.effort === 'high')
    manager!.setModel(SESSION, 'fast')
    const switched = await until((s) => s.model === 'claude-fast-2')
    expect(switched.effort).toBe('high')
  }, 20000)
})

describe('ChatManager: commands and /clear', () => {
  it('lists claude\'s slash commands, and follows /clear onto the new session it starts', async () => {
    const { until } = start()
    const listed = await until((s) => s.commands !== null)
    expect(listed.commands!.map((c) => c.name)).toEqual(['clear', 'compact', 'context'])
    manager!.send(SESSION, '/clear')
    const moved = await until((s) => s.previousSessionId === SESSION)
    expect(moved.sessionId).not.toBe(SESSION)
    expect(manager!.has(moved.sessionId)).toBe(true)
    expect(manager!.has(SESSION)).toBe(false)
    manager!.send(moved.sessionId, 'after')
    const after = await until((s) => s.status === 'idle' && textOf(s).includes('You said: after'))
    expect(after.sessionId).toBe(moved.sessionId)
  }, 20000)
})
