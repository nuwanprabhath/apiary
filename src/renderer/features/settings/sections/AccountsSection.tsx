import { type JSX, useState } from 'react'
import type { AccountInfo } from '@shared/domain/accounts'
import type { AccountId } from '@shared/domain/ids'
import type { NewSessionInfo } from '@shared/types'
import { errorMessage } from '@shared/errors'
import {
  addAccount, removeAccount, setDefaultAccount, startAccountLogin, useAccounts,
} from '../../../state/accountsStore'
import { ErrorBoundary } from '../../../ui/ErrorBoundary'
import { Modal } from '../../../ui/Modal'
import { focusAskedFor } from '../../../ui/focusUnlessTyping'

const MAX_LABEL = 40

/** The muted line under an account's label: whose login it is, or that it has none yet. */
const detail = (a: AccountInfo): string => {
  const who = a.email ?? 'Not logged in'
  return a.isMain ? `This Mac's Claude login · ${who}` : who
}

function RemoveDialog({ label, onCancel, onConfirm }: { label: string; onCancel: () => void; onConfirm: () => void }): JSX.Element {
  return (
    <ErrorBoundary label="This dialog">
      <Modal
        testId="account-remove-dialog"
        titleId="account-remove-title"
        onClose={onCancel}
        // A destructive confirm lands on the safe answer, so a stray Enter removes nothing.
        initialFocusSelector='[data-testid="account-remove-cancel"]'
      >
        <h2 id="account-remove-title">Remove the account &apos;{label}&apos;?</h2>
        <p>Its login is deleted from this Mac. Its conversations stay.</p>
        <div className="modal-actions">
          <button className="btn" data-testid="account-remove-cancel" onClick={onCancel}>Cancel</button>
          <button className="btn danger" data-testid="account-remove-confirm" onClick={onConfirm}>Remove</button>
        </div>
      </Modal>
    </ErrorBoundary>
  )
}

/**
 * Settings → Accounts. Changes here are not part of the dialog's draft: main applies each at once
 * and every window hears `accountsChanged`, so an email appears by itself after a login.
 * `onLoginStarted` opens the login session as a tab, the way "New session" does.
 */
export function AccountsSection({ onLoginStarted }: { onLoginStarted: (info: NewSessionInfo) => void }): JSX.Element {
  const { accounts, defaultId } = useAccounts()
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [removing, setRemoving] = useState<AccountInfo | null>(null)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [addError, setAddError] = useState<string | null>(null)

  const fail = (key: string, e: unknown): void => { setErrors((prev) => ({ ...prev, [key]: errorMessage(e) })) }
  const clear = (key: string): void => { setErrors((prev) => ({ ...prev, [key]: '' })) }

  const login = async (id: AccountId): Promise<void> => {
    clear(id)
    try { onLoginStarted(await startAccountLogin(id)) } catch (e) { fail(id, e) }
  }
  const remove = async (a: AccountInfo): Promise<void> => {
    setRemoving(null)
    clear(a.id)
    try { await removeAccount(a.id) } catch (e) { fail(a.id, e) }
  }
  const add = async (): Promise<void> => {
    const label = name.trim()
    if (label === '') return
    setAddError(null)
    try {
      const id = await addAccount(label)
      setAdding(false)
      setName('')
      onLoginStarted(await startAccountLogin(id))
    } catch (e) { setAddError(errorMessage(e)) }
  }
  const cancelAdd = (): void => { setAdding(false); setName(''); setAddError(null) }

  return (
    <div data-testid="accounts-section">
      {accounts.map((a) => (
        <div className="settings-row settings-row-stacked account-row" key={a.id} data-testid={`account-${a.id}`}>
          <div className="account-line">
            <span className="account-who">
              <strong className="account-label">{a.label}</strong>
              <span className="settings-help account-detail">{detail(a)}</span>
            </span>
            <span className="account-actions">
              <button className="btn quiet small" data-testid={`account-login-${a.id}`} onClick={() => { void login(a.id) }}>Log in</button>
              {!a.isMain && (
                <button className="btn quiet small danger" data-testid={`account-remove-${a.id}`} onClick={() => { setRemoving(a) }}>Remove…</button>
              )}
            </span>
          </div>
          {(errors[a.id] ?? '') !== '' && (
            <span className="settings-help remote-pairing-error" role="alert" data-testid={`account-error-${a.id}`}>{errors[a.id]}</span>
          )}
        </div>
      ))}

      <label className="settings-row settings-row-stacked">
        <strong>Default account</strong>
        <select
          className="search"
          data-testid="account-default-select"
          value={defaultId}
          onChange={(e) => {
            clear('default')
            const picked = accounts.find((a) => a.id === e.target.value)
            if (picked === undefined) return
            setDefaultAccount(picked.id).catch((err: unknown) => { fail('default', err) })
          }}
        >
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
        </select>
        {(errors.default ?? '') !== '' && (
          <span className="settings-help remote-pairing-error" role="alert">{errors.default}</span>
        )}
      </label>

      <div className="settings-row settings-row-stacked">
        {adding ? (
          <div className="account-add" data-testid="account-add-row">
            <label className="settings-field-label" htmlFor="account-name">Account name</label>
            <div className="account-add-line">
              <input
                id="account-name" className="search account-add-input"
                  data-testid="account-name"
                  value={name}
                  maxLength={MAX_LABEL}
                  placeholder="e.g. Work"
                  ref={focusAskedFor}
                  onChange={(e) => { setName(e.target.value) }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); void add() }
                    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelAdd() }
                  }}
                />
              <button className="btn primary" data-testid="account-add-confirm" disabled={name.trim() === ''} onClick={() => { void add() }}>Add</button>
              <button className="btn" data-testid="account-add-cancel" onClick={cancelAdd}>Cancel</button>
            </div>
          </div>
        ) : (
          <div>
            <button className="btn small" data-testid="account-add" onClick={() => { setAdding(true) }}>Add account…</button>
          </div>
        )}
        {addError !== null && (
          <span className="settings-help remote-pairing-error" role="alert" data-testid="account-add-error">{addError}</span>
        )}
      </div>

      {removing !== null && (
        <RemoveDialog label={removing.label} onCancel={() => { setRemoving(null) }} onConfirm={() => { void remove(removing) }} />
      )}
    </div>
  )
}
