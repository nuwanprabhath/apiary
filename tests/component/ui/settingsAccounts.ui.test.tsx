import { describe, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from '../renderApp'
import { until } from '../helpers'
import type { FakeApiary } from '../fakeApiary'
import { MAIN_ACCOUNT_ID, type AccountInfo } from '@shared/domain/accounts'
import { asAccountId } from '@shared/domain/ids'
import { reviewUi, type UiWidth } from './review'

const MAIN: AccountInfo = { id: MAIN_ACCOUNT_ID, label: 'Main', email: 'me@example.com', isMain: true }
const added = (id: string, label: string, email: string | null): AccountInfo => ({ id: asAccountId(id), label, email, isMain: false })

/** Settings → Accounts with `accounts` already in main's list. */
async function openAccounts(accounts: AccountInfo[], arrange: (fake: FakeApiary) => void = () => undefined): Promise<FakeApiary> {
  const { fake } = await renderApp()
  fake.state.accounts = { accounts, defaultId: MAIN_ACCOUNT_ID }
  arrange(fake)
  fake.emit('accountsChanged', fake.state.accounts)
  fake.emit('openSettingsDialog')
  await until(() => document.querySelector('[data-testid="settings-dialog"]') !== null)
  await userEvent.click(page.getByTestId('settings-nav-accounts'))
  await until(() => document.querySelector(`[data-testid="account-${accounts[accounts.length - 1].id}"]`) !== null)
  return fake
}

const WIDTHS: UiWidth[] = [620, 1000]

describe('UI: Settings → Accounts', () => {
  it('accounts: only main, logged in', async () => {
    await openAccounts([MAIN])
    await reviewUi('accounts only main', { widths: WIDTHS })
  })

  it('accounts: three accounts, one not logged in', async () => {
    await openAccounts([MAIN, added('work', 'Work', 'work@example.com'), added('side', 'Side project', null)])
    await reviewUi('accounts three', { widths: WIDTHS })
  })

  it('accounts: the add row open with a long name', async () => {
    await openAccounts([MAIN])
    await userEvent.click(page.getByTestId('account-add'))
    await userEvent.fill(page.getByTestId('account-name'), 'A very long account name for the work')
    await reviewUi('accounts add row', { widths: WIDTHS })
  })

  it('accounts: a refused remove', async () => {
    const fake = await openAccounts([MAIN, added('work', 'Work', 'work@example.com')])
    fake.override('accountsRemove', async () => { throw new Error('Close the sessions using Work first') })
    await userEvent.click(page.getByTestId('account-remove-work'))
    await userEvent.click(page.getByTestId('account-remove-confirm'))
    await until(() => document.querySelector('[data-testid="account-error-work"]') !== null)
    await reviewUi('accounts refused remove', { widths: WIDTHS })
  })
})
