import { describe, it, expect, expectTypeOf } from 'vitest'
import type { broadcast } from '../../src/main/windows/broadcast'
import { IPC, type ApiaryApi } from '@shared/ipc/contract'
import { invoke, invokeLoose } from '@shared/ipc/define'
import { str, num, obj, tuple, type Guard } from '@shared/ipc/guards'
import { Logger } from '../../src/main/log/logger'
import type { LogScope } from '@shared/domain/log'
import type { PetPatch, PetsState } from '@shared/pets/state'
import type { VoiceContext } from '@shared/pets/prompt'
import type { ChatState } from '@shared/domain/chat'
import type { SessionId } from '@shared/domain/ids'

/**
 * The compile-time half of the guard layer. `npm run typecheck` is the proof: each `@ts-expect-error`
 * below is an error tsc must report (an unused directive is itself an error), so removing the
 * strictness it covers fails the typecheck. The runtime assertions only keep the file honest.
 */
describe('contract types', () => {
  it('invoke() requires a guard that proves the declared arguments', () => {
    // A guard that proves exactly the declared tuple is fine.
    invoke<[id: string, n: number], void>('t:ok', tuple(str, num))
    // A guard for a different type is not.
    // @ts-expect-error -- `num` proves a number where a string is declared
    invoke<[id: string], void>('t:wrong', tuple(num))
    // A guard that proves less than the declared object type is not.
    // @ts-expect-error -- `{ x: number }` is not proven by a bare `Record<string, unknown>`
    invoke<[value: { x: number }], void>('t:loose', tuple(obj))
    // A guard of the wrong length is not.
    // @ts-expect-error -- two arguments are declared and one is checked
    invoke<[a: string, b: string], void>('t:short', tuple(str))
    // The audited escape hatch accepts it, and says so on the spec.
    expect(invokeLoose<[value: { x: number }], void>('t:loose', tuple(obj)).loose).toBe(true)
    expect(invoke<[], void>('t:strict', tuple()).loose).toBeUndefined()
  })

  it('the pet channels carry guards of their declared types', () => {
    expectTypeOf(IPC.petUpdate.args).toEqualTypeOf<Guard<[id: string, patch: PetPatch]>>()
    expectTypeOf(IPC.petVoice.args).toEqualTypeOf<Guard<[id: string, context: VoiceContext]>>()
    expect(IPC.petUpdate.loose).toBeUndefined()
    expect(IPC.petVoice.loose).toBeUndefined()
  })

  it('broadcast() takes the event and a payload of its type', () => {
    const send: typeof broadcast = () => {}
    send(IPC.petsChanged, {} as PetsState)
    send(IPC.treeChanged)
    // @ts-expect-error -- petsChanged carries a PetsState
    send(IPC.petsChanged, { enabled: true })
    // @ts-expect-error -- and a payload is required
    send(IPC.petsChanged)
    // @ts-expect-error -- treeChanged carries nothing
    send(IPC.treeChanged, 1)
    // @ts-expect-error -- a bare channel string carries no payload type, so it is not an event
    send('apiary:pets-changed', {} as PetsState)
    // @ts-expect-error -- an invoke channel is not an event
    send(IPC.petsState)
    expect(true).toBe(true)
  })

  it('the renderer subscription is typed from the same payload', () => {
    expectTypeOf<Parameters<Parameters<ApiaryApi['onPetsChanged']>[0]>>().toEqualTypeOf<[state: PetsState]>()
    expectTypeOf<Parameters<Parameters<ApiaryApi['onChatChanged']>[0]>>().toEqualTypeOf<[state: ChatState]>()
    expect(IPC.petsChanged.kind).toBe('event')
  })

  it('chat state names its session with the branded id', () => {
    expectTypeOf<ChatState['sessionId']>().toEqualTypeOf<SessionId>()
    expectTypeOf<ChatState['previousSessionId']>().toEqualTypeOf<SessionId | null>()
    expect(IPC.chatChanged.kind).toBe('event')
  })
})

describe('log scopes', () => {
  it('log() takes a LogScope, so an unknown scope is a compile error', () => {
    const logger = new Logger()
    logger.info('pets', 'fine')
    logger.warn('layout', 'fine')
    // @ts-expect-error -- 'not-a-scope' is not in LogScope (shared/domain/log.ts)
    logger.info('not-a-scope', 'rejected')
    // @ts-expect-error -- nor on log() itself
    logger.log('info', 'also-not-a-scope', 'rejected')
    expectTypeOf<Parameters<Logger['debug']>[0]>().toEqualTypeOf<LogScope>()
    expect(logger.enabled).toBe(false)
  })
})
