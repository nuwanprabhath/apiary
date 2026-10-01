import { describe, it, expect } from 'vitest'
import { emptyChatState, type ChatState } from '../../src/shared/domain/chat'
import {
  parseLine, permissionReply, permissionRequestOf, reduce, userLine, controlLine, type Line,
} from '../../src/main/chat/protocol'

/** The shape of a real turn, as `claude` 2.1.286 printed it: a Write that needed permission. */
const TURN: Line[] = [
  { type: 'system', subtype: 'init', model: 'claude-haiku-4-5', permissionMode: 'default', session_id: 's' },
  { type: 'user', uuid: 'u1', message: { role: 'user', content: [{ type: 'text', text: 'make hello.txt' }] } },
  { type: 'stream_event', event: { type: 'message_start' } },
  { type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'thinking' } } },
  { type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'text', text: '' } } },
  { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Writ' } } },
  { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ing it.' } } },
  {
    type: 'assistant', uuid: 'a1',
    message: {
      role: 'assistant', content: [{ type: 'text', text: 'Writing it.' }],
      usage: { input_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200 },
    },
  },
  {
    type: 'assistant', uuid: 'a2',
    message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Write', input: { file_path: 'hello.txt', content: 'hi' } }] },
  },
  {
    type: 'control_request', request_id: 'r1',
    request: {
      subtype: 'can_use_tool', tool_name: 'Write', description: 'hello.txt',
      input: { file_path: 'hello.txt', content: 'hi' },
      permission_suggestions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }],
    },
  },
]

const run = (events: Line[], from: ChatState = { ...emptyChatState('s'), status: 'busy' }): ChatState =>
  events.reduce(reduce, from)

describe('chat protocol', () => {
  it('reads the model and permission mode from init', () => {
    const s = run(TURN.slice(0, 1))
    expect(s.model).toBe('claude-haiku-4-5')
    expect(s.permissionMode).toBe('default')
  })

  it('streams text as it is written, then hands it to the whole message', () => {
    const streaming = run(TURN.slice(0, 7))
    expect(streaming.streaming).toMatchObject({ text: 'Writing it.', thinking: false })
    const done = run(TURN.slice(0, 8))
    expect(done.streaming).toBeNull()
    expect(done.live.map((m) => m.uuid)).toEqual(['u1', 'a1'])
    expect(done.contextUsed).toBe(1210)
  })

  it('shows thinking while a thinking block streams, with Claude\'s token estimate', () => {
    const s = reduce(run(TURN.slice(0, 4)), { type: 'system', subtype: 'thinking_tokens', estimated_tokens: 340 })
    expect(s.streaming).toMatchObject({ text: '', thinking: true, thinkingTokens: 340 })
  })

  it('remembers how long a thinking block took, by its message', () => {
    let s = reduce(run(TURN.slice(0, 3)), TURN[3], 1000)
    s = reduce(s, { type: 'system', subtype: 'thinking_tokens', estimated_tokens: 512 }, 1500)
    s = reduce(s, { type: 'assistant', uuid: 'th1', message: { role: 'assistant', content: [{ type: 'thinking', thinking: '' }] } }, 5200)
    expect(s.thoughts).toEqual({ th1: { seconds: 4, tokens: 512 } })
  })

  it('collects a permission prompt, once, and forgets it when Claude cancels it', () => {
    const s = run([...TURN, TURN[TURN.length - 1]])
    expect(s.permissions).toEqual([{
      requestId: 'r1', toolName: 'Write', description: 'hello.txt',
      input: { file_path: 'hello.txt', content: 'hi' }, canAlwaysAllow: true,
    }])
    expect(reduce(s, { type: 'control_cancel_request', request_id: 'r1' }).permissions).toEqual([])
  })

  it('ends a turn idle, with the context window from the result', () => {
    const s = run([...TURN, { type: 'result', subtype: 'success', modelUsage: { m: { contextWindow: 200000 } } }])
    expect(s.status).toBe('idle')
    expect(s.permissions).toEqual([])
    expect(s.contextWindow).toBe(200000)
  })

  it('keeps a message once even if it is seen twice, and ignores subagent streaming', () => {
    const s = run([TURN[7], TURN[7]])
    expect(s.live).toHaveLength(1)
    const sub = reduce(s, { type: 'stream_event', parent_tool_use_id: 't9', event: { type: 'message_start' } })
    expect(sub).toBe(s)
  })

  it('answers a permission prompt the way the SDK does', () => {
    const prompt = permissionRequestOf(TURN[9])
    expect(prompt).not.toBeNull()
    const pending = prompt!.pending
    expect(permissionReply('r1', { behavior: 'allow' }, pending)).toEqual({
      type: 'control_response',
      response: { subtype: 'success', request_id: 'r1', response: { behavior: 'allow', updatedInput: pending.input } },
    })
    expect(permissionReply('r1', { behavior: 'allow', always: true }, pending).response).toMatchObject({
      response: { updatedPermissions: pending.suggestions },
    })
    expect(permissionReply('r1', { behavior: 'deny' }, pending).response).toMatchObject({
      response: { behavior: 'deny', message: 'The user declined this.' },
    })
  })

  it('writes user messages and control requests as the SDK does', () => {
    expect(userLine('hi')).toEqual({
      type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'hi' }] }, parent_tool_use_id: null, session_id: '',
    })
    expect(controlLine('c1', { subtype: 'interrupt' })).toEqual({ type: 'control_request', request_id: 'c1', request: { subtype: 'interrupt' } })
  })

  it('ignores what a login shell prints before claude starts', () => {
    expect(parseLine('Welcome to Ubuntu')).toBeNull()
    expect(parseLine('{"type":"result"')).toBeNull()
    expect(parseLine('{"type":"result"}')).toEqual({ type: 'result' })
  })
})
