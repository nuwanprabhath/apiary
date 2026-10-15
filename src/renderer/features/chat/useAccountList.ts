import { useEffect, useState } from 'react'
import type { AccountInfo, AccountsState } from '@shared/domain/accounts'
import type { AccountId, SessionId } from '@shared/domain/ids'
import { accountById, useAccounts, useSessionAccount } from '../../state/accountsStore'
import { pickAccount } from '../../state/sessionBusy'
import { useEscape } from '../../ui/useEscape'

export interface AccountList {
  accounts: AccountsState
  account: AccountInfo | null
  currentId: AccountId | null
  /** True while the list of accounts has replaced the "/" menu's full list. */
  showing: boolean
  open: () => void
  back: () => void
  /** Switches the session (asking first when it is busy) and closes the menu; the current account only closes it. */
  pick: (id: AccountId) => void
}

/** The "/" menu's Account view: the accounts in place of the full list, Esc or ← going back. */
export function useAccountList({ sessionId, menuOpen, setActive, close, onFocusBox }: {
  sessionId: SessionId | null
  menuOpen: boolean
  setActive: (i: number) => void
  close: () => void
  onFocusBox: () => void
}): AccountList {
  const accounts = useAccounts()
  const currentId = useSessionAccount(sessionId)
  const [showing, setShowing] = useState(false)
  useEffect(() => { if (!menuOpen) setShowing(false) }, [menuOpen])
  const back = (): void => { setShowing(false); setActive(0) }
  // Registered after the menu's own, so Esc in the list goes back to the full list first.
  useEscape(back, { enabled: menuOpen && showing })
  return {
    accounts,
    account: accountById(accounts, currentId),
    currentId,
    showing,
    open: () => {
      setShowing(true)
      setActive(Math.max(0, accounts.accounts.findIndex((a) => a.id === currentId)))
    },
    back,
    pick: (id) => {
      close()
      if (sessionId !== null && id !== currentId) pickAccount(sessionId, id)
      onFocusBox()
    },
  }
}
