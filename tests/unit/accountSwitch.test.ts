import { describe, it, expect, beforeEach, vi } from 'vitest'
import { asAccountId, asSessionId } from '@shared/domain/ids'
import type { ChatState } from '@shared/domain/chat'
import {
  answerSwitchQuestion, cancelPendingSwitch, chooseAccount, settleIdle,
} from '../../src/renderer/state/accountSwitch'
import { busyOf } from '../../src/renderer/state/sessionBusy'

// The stores read `window.apiary` to notice a component test's new bridge; give Node one before they load.
const g = vi.hoisted(() => {
  const holder = globalThis as unknown as { window: { apiary: unknown } }
  holder.window = { apiary: {} }
  return holder
})
const S = asSessionId('11111111-1111-4111-8111-111111111111')
const WORK = asAccountId('work')
const HOME = asAccountId('home')

let sw: ReturnType<typeof vi.fn>
beforeEach(() => {
  sw = vi.fn(async () => {})
  g.window = { apiary: { sessionAccountSwitch: sw } }
})

describe('the pending account switch', () => {
  it('switches at once when idle', () => {
    chooseAccount(S, WORK, false)
    expect(sw).toHaveBeenCalledExactlyOnceWith(S, WORK)
  })

  it('asks when busy and switches nothing until answered', () => {
    chooseAccount(S, WORK, true)
    expect(sw).not.toHaveBeenCalled()
    answerSwitchQuestion('now')
    expect(sw).toHaveBeenCalledExactlyOnceWith(S, WORK)
  })

  it('waits for idle, then switches once and forgets', () => {
    chooseAccount(S, WORK, true)
    answerSwitchQuestion('later')
    settleIdle(S)
    settleIdle(S)
    expect(sw).toHaveBeenCalledExactlyOnceWith(S, WORK)
  })

  it('does nothing when idle with nothing waiting, and on Don’t switch', () => {
    settleIdle(S)
    chooseAccount(S, WORK, true)
    answerSwitchQuestion('none')
    settleIdle(S)
    expect(sw).not.toHaveBeenCalled()
  })

  it('a send cancels a waiting switch', () => {
    chooseAccount(S, WORK, true)
    answerSwitchQuestion('later')
    cancelPendingSwitch(S)
    settleIdle(S)
    expect(sw).not.toHaveBeenCalled()
  })

  it('a newer pick replaces the waiting account', () => {
    chooseAccount(S, WORK, true)
    answerSwitchQuestion('later')
    chooseAccount(S, HOME, true)
    answerSwitchQuestion('later')
    settleIdle(S)
    expect(sw).toHaveBeenCalledExactlyOnceWith(S, HOME)
  })
})

describe('busyOf', () => {
  const chat = (status: ChatState['status']): ChatState => ({ status }) as ChatState
  it('is busy for a busy chat turn or a busy pty on the session', () => {
    expect(busyOf(chat('busy'), {}, S)).toBe(true)
    expect(busyOf(chat('idle'), {}, S)).toBe(false)
    expect(busyOf(null, { p: { sessionId: S, name: null, nameIsUser: false, status: 'busy' } }, S)).toBe(true)
    expect(busyOf(null, { p: { sessionId: 'other', name: null, nameIsUser: false, status: 'busy' } }, S)).toBe(false)
  })
})
