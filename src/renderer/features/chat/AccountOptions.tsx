import type { JSX } from 'react'
import type { AccountInfo } from '@shared/domain/accounts'
import type { AccountId } from '@shared/domain/ids'
import { CheckIcon } from '../../ui/icons'
import { Listbox, optionId } from '../../ui/Listbox'
import { Row } from './PaletteRow'

/** The "/" menu's list of accounts, shown in place of the full list; the current one has a check. */
export function AccountOptions({ accounts, currentId, active, listId, onMouseEnter, onChoose }: {
  accounts: readonly AccountInfo[]
  currentId: AccountId | null
  active: number
  listId: string
  onMouseEnter: (i: number) => void
  onChoose: (a: AccountInfo) => void
}): JSX.Element {
  return (
    <Listbox id={listId} label="Accounts" className="chat-command-list">
      <div className="chat-menu-heading" role="presentation">Account</div>
      <div className="chat-command-group" role="presentation">
        {accounts.map((a, i) => (
          <Row
            key={a.id}
            id={optionId(listId, i)}
            selected={i === active}
            testId="composer-account-option"
            extra={{ 'data-account': a.id, 'aria-checked': String(a.id === currentId) }}
            onEnter={() => { onMouseEnter(i) }}
            onClick={() => { onChoose(a) }}
          >
            {[
              <span key="n" className="chat-command-name" title={a.label}>
                {a.label}
                {a.id === currentId && <CheckIcon className="chat-account-check" />}
              </span>,
              <span key="d" className="chat-command-desc">{a.email ?? 'Not logged in'}</span>,
            ]}
          </Row>
        ))}
      </div>
    </Listbox>
  )
}
