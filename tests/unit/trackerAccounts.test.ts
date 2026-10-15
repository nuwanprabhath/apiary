import { describe, expect, it } from 'vitest'
import { asAccountId, asSessionId, type AccountId, type SessionId } from '@shared/domain/ids'
import type { PtySessionInfo } from '@shared/api'
import { rememberAccounts } from '../../src/main/claude/trackerAccounts'

const WORK = asAccountId('work')
const OLD = '11111111-1111-4111-8111-111111111111'
const CLEARED = '22222222-2222-4222-8222-222222222222'

function info(sessionId: string): PtySessionInfo {
  return { sessionId, name: null, nameIsUser: false, status: 'idle' }
}

describe('rememberAccounts', () => {
  it('records the account of a terminal whose /clear moved it to a new session', () => {
    const recorded = new Map<SessionId, AccountId>()
    const pty = { accountOf: (id: string) => (id === OLD ? WORK : null) }
    rememberAccounts({ [OLD]: info(CLEARED) }, pty, {
      configRootFor: () => '/root', setAccountOf: (id, a) => { recorded.set(id, a) },
    })
    expect(recorded.get(asSessionId(CLEARED))).toBe(WORK)
  })

  it('records a pending pty’s new session under the account it was started in', () => {
    const recorded = new Map<SessionId, AccountId>()
    const pending = `new:${OLD}`
    const pty = { accountOf: (id: string) => (id === pending ? WORK : null) }
    rememberAccounts({ [pending]: info(CLEARED) }, pty, {
      configRootFor: () => '/root', setAccountOf: (id, a) => { recorded.set(id, a) },
    })
    expect(recorded.get(asSessionId(CLEARED))).toBe(WORK)
  })
})
