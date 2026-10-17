import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { until } from './helpers'
import type { FakeApiary } from './fakeApiary'
import { addAccount } from '../../src/renderer/state/accountsStore'

/** Settings → Accounts: the rows, adding with a login tab, removing after a confirm, the default. */
// `arrange` runs before the app mounts: the status bar reads the accounts from the first paint, so a
// change made afterwards without the event main would send is never seen.
// `after` runs once it is up, for a change made through the app's own commands.
async function openAccounts(
  arrange: (fake: FakeApiary) => void = () => undefined, after: () => Promise<unknown> = async () => undefined,
): Promise<FakeApiary> {
  const { fake } = await renderApp({}, arrange)
  await after()
  fake.emit('openSettingsDialog')
  await until(() => document.querySelector('[data-testid="settings-dialog"]') !== null)
  await userEvent.click(page.getByTestId('settings-nav-accounts'))
  await until(() => document.querySelector('[data-testid="accounts-section"]') !== null)
  return fake
}
const el = (id: string): Element | null => document.querySelector(`[data-testid="${id}"]`)

describe('Settings → Accounts', () => {
  it('lists main with its email', async () => {
    await openAccounts((fake) => {
      fake.state.accounts = {
        ...fake.state.accounts,
        accounts: [{ ...fake.state.accounts.accounts[0], email: 'me@example.com' }],
      }
    })
    await until(() => (el('account-main')?.textContent ?? '').includes("This Mac's Claude login · me@example.com"))
    expect(el('account-main')?.textContent).toContain('Main')
  })

  it('renames main and an added account; Escape keeps the old name', async () => {
    const fake = await openAccounts(() => undefined, () => addAccount('Work'))
    await until(() => el('account-rename-work') !== null)
    await userEvent.click(page.getByTestId('account-rename-main'))
    await userEvent.fill(page.getByTestId('account-rename-input-main'), 'Personal')
    await userEvent.keyboard('{Enter}')
    await until(() => el('account-main')?.querySelector('.account-label')?.textContent === 'Personal')
    await userEvent.click(page.getByTestId('account-rename-work'))
    await userEvent.fill(page.getByTestId('account-rename-input-work'), 'Uni')
    await userEvent.click(page.getByTestId('account-rename-save-work'))
    await until(() => el('account-work')?.querySelector('.account-label')?.textContent === 'Uni')
    expect([...(el('account-default-select') as HTMLSelectElement).options].map((o) => o.text)).toEqual(['Personal', 'Uni'])
    await userEvent.click(page.getByTestId('account-rename-work'))
    await userEvent.fill(page.getByTestId('account-rename-input-work'), 'Nope')
    await userEvent.keyboard('{Escape}')
    await until(() => el('account-rename-input-work') === null)
    expect(fake.callsTo('accountsRename')).toEqual([['main', 'Personal'], ['work', 'Uni']])
    expect(el('settings-dialog')).not.toBeNull()
  })

  it('main has no Remove', async () => {
    await openAccounts()
    expect(el('account-login-main')).not.toBeNull()
    expect(el('account-remove-main')).toBeNull()
  })

  it('Add is disabled while the name is blank', async () => {
    await openAccounts()
    await userEvent.click(page.getByTestId('account-add'))
    await until(() => el('account-name') !== null)
    const add = el('account-add-confirm') as HTMLButtonElement
    expect(add.disabled).toBe(true)
    await userEvent.fill(page.getByTestId('account-name'), '  ')
    expect(add.disabled).toBe(true)
    await userEvent.fill(page.getByTestId('account-name'), 'Work')
    expect(add.disabled).toBe(false)
  })

  it('add creates an account and opens its login tab', async () => {
    const fake = await openAccounts()
    await userEvent.click(page.getByTestId('account-add'))
    await userEvent.fill(page.getByTestId('account-name'), 'Work')
    await userEvent.click(page.getByTestId('account-add-confirm'))
    await until(() => fake.callsTo('accountsLogin').length === 1)
    expect(fake.callsTo('accountsAdd')[0]).toEqual(['Work'])
    expect(fake.state.accounts.accounts.map((a) => a.id)).toEqual(['main', 'work'])
    expect(fake.callsTo('accountsLogin')[0]).toEqual(['work'])
    // The dialog closes and the login session is a tab.
    await until(() => el('settings-dialog') === null)
    await until(() => el('session-tab') !== null)
  })

  it('remove asks and removes', async () => {
    const fake = await openAccounts(undefined, () => addAccount('Work'))
    await until(() => el('account-remove-work') !== null)
    await userEvent.click(page.getByTestId('account-remove-work'))
    await until(() => el('account-remove-dialog') !== null)
    expect(el('account-remove-dialog')?.textContent).toContain("Remove the account 'Work'?")
    expect(fake.callsTo('accountsRemove')).toHaveLength(0)
    await userEvent.click(page.getByTestId('account-remove-confirm'))
    await until(() => el('account-work') === null)
    expect(fake.callsTo('accountsRemove')[0]).toEqual(['work'])
  })

  it("a refused remove shows main's reason under the row", async () => {
    const fake = await openAccounts(undefined, () => addAccount('Work'))
    fake.override('accountsRemove', async () => { throw new Error('Close the sessions using Work first') })
    await until(() => el('account-remove-work') !== null)
    await userEvent.click(page.getByTestId('account-remove-work'))
    await userEvent.click(page.getByTestId('account-remove-confirm'))
    await until(() => (el('account-error-work')?.textContent ?? '').includes('Close the sessions using Work first'))
    expect(el('account-work')).not.toBeNull()
  })

  it('default select changes the default', async () => {
    const fake = await openAccounts(undefined, () => addAccount('Work'))
    await until(() => el('account-work') !== null)
    await userEvent.selectOptions(page.getByTestId('account-default-select'), 'work')
    await until(() => fake.state.accounts.defaultId === 'work')
    expect(fake.callsTo('accountsSetDefault')[0]).toEqual(['work'])
  })
})
