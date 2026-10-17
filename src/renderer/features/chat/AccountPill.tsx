import type { JSX } from 'react'
import type { SessionId } from '@shared/domain/ids'
import { accountById, useAccounts, useSessionAccount } from '../../state/accountsStore'

/**
 * The account a chat runs under, in the message box's bottom bar, only when it is not the default
 * one: a chat in the account new sessions start in needs no label. Hover shows its login.
 */
export function AccountPill({ sessionId }: { sessionId: SessionId }): JSX.Element | null {
  const accounts = useAccounts()
  const account = accountById(accounts, useSessionAccount(sessionId))
  if (account === null || account.id === accounts.defaultId) return null
  return (
    <span className="chat-account-pill" data-testid="chat-account-pill" title={`Account: ${account.label} · ${account.email ?? 'Not logged in'}`}>
      {account.label}
    </span>
  )
}
