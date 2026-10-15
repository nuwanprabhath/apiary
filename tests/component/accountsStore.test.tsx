import { describe, it, expect, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { createFakeApiary, type FakeApiary } from './fakeApiary'
import { until } from './helpers'
import { asSessionId, type SessionId } from '@shared/domain/ids'
import {
  accountById, addAccount, hasSeveralAccounts, removeAccount, setDefaultAccount, startAccountLogin, switchSessionAccount,
  useAccounts, useSessionAccount,
} from '../../src/renderer/state/accountsStore'

/**
 * The accounts store: the list follows `accountsChanged`, and a session's account is asked again
 * after a switch, since main only says that something changed.
 */
const SESSION = asSessionId('33333333-3333-4333-8333-333333333333')

let root: Root | null = null
afterEach(() => { root?.unmount(); root = null; document.body.replaceChildren() })

function Probe({ sessionId }: { sessionId: SessionId | null }) {
  const accounts = useAccounts()
  const account = useSessionAccount(sessionId)
  return <p data-testid="probe">{accounts.accounts.map((a) => a.id).join(',')}|{account ?? 'none'}</p>
}

function mount(sessionId: SessionId | null): FakeApiary {
  const fake = createFakeApiary()
  window.apiary = fake
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  root.render(<Probe sessionId={sessionId} />)
  return fake
}

const text = (): string => document.querySelector('[data-testid="probe"]')?.textContent ?? ''

describe('accountsStore', () => {
  it('follows an added account and a session switched to it', async () => {
    mount(SESSION)
    await until(() => text() === 'main|main')
    const work = await addAccount('Work')
    await until(() => text() === 'main,work|main')
    await switchSessionAccount(SESSION, work)
    await until(() => text() === 'main,work|work')
    expect(text()).toBe('main,work|work')
  })

  it('removing the account a session was on puts it back on the default', async () => {
    mount(SESSION)
    const work = await addAccount('Work')
    await setDefaultAccount(work)
    await until(() => text() === 'main,work|work')
    await removeAccount(work)
    await until(() => text() === 'main|main')
    expect(text()).toBe('main|main')
  })

  it('a login starts a new session, and the helpers read the list', async () => {
    const fake = mount(null)
    const work = await addAccount('Work')
    const login = await startAccountLogin(work)
    expect(login.ptyId).toMatch(/^new:/)
    const state = await fake.accountsList()
    expect(hasSeveralAccounts(state)).toBe(true)
    expect(accountById(state, work)?.label).toBe('Work')
    expect(accountById(state, null)).toBeNull()
  })

  it('asks main nothing for a pane with no session', async () => {
    const fake = mount(null)
    await until(() => text() === 'main|none')
    expect(fake.callsTo('sessionAccountGet')).toHaveLength(0)
  })
})
