import { describe, it, expect, vi } from 'vitest'
import { accountsHandlers } from '../../src/main/ipc/handlers/accounts'
import { rememberAccounts, trackedProcesses } from '../../src/main/claude/trackerAccounts'
import type { AccountService } from '../../src/main/accounts/accountService'
import type { ChatService } from '../../src/main/chat/chatService'
import type { AppService } from '../../src/main/appService'
import type { PtyManager } from '../../src/main/pty/ptyManager'
import { asAccountId, asSessionId } from '@shared/domain/ids'
import { WORK } from '../fixtures/launchAccounts'

const event = undefined as never

function handlers(inUse: boolean) {
  const remove = vi.fn()
  const accounts = {
    list: () => ({ accounts: [{ id: WORK, label: 'Work Team', email: null, isMain: false }], defaultId: asAccountId('main') }),
    remove,
  } as unknown as AccountService
  const chat = { accountInUse: () => inUse } as unknown as ChatService
  return { remove, h: accountsHandlers(accounts, chat, {} as AppService) }
}

describe('accountsRemove', () => {
  it('removing an account with a live session is refused', async () => {
    const { h, remove } = handlers(true)
    await expect(async () => h.accountsRemove(event, WORK)).rejects.toThrow('Close the sessions using Work Team first')
    expect(remove).not.toHaveBeenCalled()
  })

  it('removes an account nothing runs under', async () => {
    const { h, remove } = handlers(false)
    await h.accountsRemove(event, WORK)
    expect(remove).toHaveBeenCalledWith(WORK)
  })
})

describe('the tracker and accounts', () => {
  const pty = (account: string | null) => ({
    tuiProcesses: () => new Map([['new:a', { pid: 9, accountId: account === null ? null : asAccountId(account) }]]),
    accountOf: (id: string) => (id === 'new:a' && account !== null ? asAccountId(account) : null),
  }) as unknown as PtyManager
  const info = { sessionId: '22222222-2222-4222-8222-222222222222', name: null, nameIsUser: false, status: null }

  it('looks for a pty\'s pid file in its own account\'s config folder', () => {
    const accounts = { configRootFor: (id: string) => `/accounts/${id}`, setAccountOf: vi.fn() }
    expect(trackedProcesses(pty('work'), '/main', accounts).get('new:a')?.sessionsDir).toBe('/accounts/work/sessions')
    expect(trackedProcesses(pty(null), '/main', accounts).get('new:a')?.sessionsDir).toBe('/main/sessions')
  })

  it('records the account of a pending pty under the session it resolved to', () => {
    const accounts = { configRootFor: () => '', setAccountOf: vi.fn() }
    rememberAccounts({ 'new:a': info, 'shell:x:1': info }, pty('work'), accounts)
    expect(accounts.setAccountOf).toHaveBeenCalledTimes(1)
    expect(accounts.setAccountOf).toHaveBeenCalledWith(asSessionId(info.sessionId), 'work')
  })
})
