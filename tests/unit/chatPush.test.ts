import { describe, it, expect } from 'vitest'
import { applyChatPush, chatPush } from '@shared/chatPush'
import { emptyChatState } from '@shared/domain/chat'
import { asSessionId } from '@shared/domain/ids'

const A = asSessionId('11111111-1111-4111-8111-111111111111')
const B = asSessionId('22222222-2222-4222-8222-222222222222')
const base = { ...emptyChatState(A), status: 'idle' as const, seq: 3 }

describe('chatPush', () => {
  it('is full for a first push, a moved session and an exit', () => {
    expect(chatPush(null, base).kind).toBe('full')
    expect(chatPush(base, { ...base, seq: 4, sessionId: B, previousSessionId: A }).kind).toBe('full')
    expect(chatPush(base, { ...base, seq: 4, status: 'exited' }).kind).toBe('full')
  })

  it('is a delta holding only the fields that changed', () => {
    const streaming = { text: 'hi', thinking: false, thinkingSince: null, thinkingTokens: null }
    const push = chatPush(base, { ...base, seq: 4, streaming })
    expect(push).toEqual({ kind: 'delta', sessionId: A, previousSessionId: null, base: 3, seq: 4, changes: { streaming } })
  })
})

describe('applyChatPush', () => {
  it('applies a delta onto the snapshot it was computed from', () => {
    const next = { ...base, seq: 4, status: 'busy' as const }
    expect(applyChatPush(base, chatPush(base, next))).toEqual(next)
  })

  it('asks for a refetch when the snapshot is behind, ahead or missing', () => {
    const push = chatPush(base, { ...base, seq: 4, status: 'busy' })
    expect(applyChatPush({ ...base, seq: 2 }, push)).toBe('refetch')
    expect(applyChatPush({ ...base, seq: 5 }, push)).toBe('refetch')
    expect(applyChatPush(null, push)).toBe('refetch')
  })

  it('takes a full state whatever the snapshot is', () => {
    expect(applyChatPush(null, { kind: 'full', state: base })).toBe(base)
  })
})
