import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { sidebarSession, until } from './helpers'
import type { FakeApiary } from './fakeApiary'
import { emptyChatState, type ChatState } from '@shared/domain/chat'
import { asAccountId, asSessionId } from '@shared/domain/ids'
import { MAIN_ACCOUNT_ID } from '@shared/domain/accounts'

/**
 * Switching a session's account from the "/" menu or its tab. A busy session asks first; the
 * waiting logic lives in `state/accountSwitch.ts`.
 */
const TITLE = 'Fix CSV export bug'
const WORK = asAccountId('work')

function twoAccounts(fake: FakeApiary): void {
  fake.state.accounts = {
    accounts: [
      { id: MAIN_ACCOUNT_ID, label: 'Main', email: 'me@home.test', isMain: true },
      { id: WORK, label: 'Work', email: null, isMain: false },
    ],
    defaultId: MAIN_ACCOUNT_ID,
  }
}

async function openChat(several = true, onWork = false): Promise<{ fake: FakeApiary; sessionId: string }> {
  const { fake } = await renderApp({ settings: { transcriptChat: true } }, several ? (f) => {
    twoAccounts(f)
    if (onWork) f.state.sessionAccounts.set(f.state.sessions.find((s) => s.title === TITLE)!.sessionId, WORK)
  } : undefined)
  await userEvent.click(sidebarSession(TITLE))
  await expect.element(page.getByTestId('chat-timeline')).toBeVisible()
  return { fake, sessionId: fake.state.sessions.find((s) => s.title === TITLE)!.sessionId }
}

function play(fake: FakeApiary, sessionId: string, patch: Partial<ChatState>): void {
  const next = { ...(fake.state.chats.get(sessionId) ?? { ...emptyChatState(asSessionId(sessionId)), status: 'idle' as const }), ...patch }
  fake.state.chats.set(sessionId, next)
  fake.emit('chatChanged', { kind: 'full', state: next })
}

const switches = (fake: FakeApiary): unknown[][] => fake.callsTo('sessionAccountSwitch')

async function openAccountList(): Promise<void> {
  await userEvent.click(page.getByTestId('composer-commands'))
  await userEvent.click(page.getByTestId('composer-action-option').first())
}

async function pickWork(): Promise<void> {
  await openAccountList()
  await userEvent.click(page.getByTestId('composer-account-option').nth(1))
}

describe('switching a session’s account', () => {
  it('no account row with one account', async () => {
    await openChat(false)
    await userEvent.click(page.getByTestId('composer-commands'))
    await expect.element(page.getByTestId('composer-command-menu')).toBeVisible()
    expect(document.querySelector('[data-action="account"]')).toBeNull()
    expect(document.querySelector('.chat-account-pill')).toBeNull()
  })

  it('a chat in the default account shows no account pill', async () => {
    await openChat()
    await expect.element(page.getByTestId('composer-commands')).toBeVisible()
    expect(document.querySelector('[data-testid="chat-account-pill"]')).toBeNull()
  })

  it('a chat in another account shows it in the message box’s bottom bar', async () => {
    await openChat(true, true)
    await expect.element(page.getByTestId('chat-account-pill')).toHaveTextContent('Work')
    expect(page.getByTestId('chat-account-pill').element().closest('[data-testid="composer"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="chat-status"] .chat-account-pill')).toBeNull()
  })

  it('the / menu lists accounts with the current one checked', async () => {
    await openChat()
    await userEvent.click(page.getByTestId('composer-commands'))
    const row = document.querySelector('[data-action="account"]')
    expect(row?.textContent).toContain('Account: Main')
    expect(row?.textContent).toContain('me@home.test')
    await userEvent.click(page.getByTestId('composer-action-option').first())
    const options = [...document.querySelectorAll('[data-testid="composer-account-option"]')]
    expect(options.map((o) => o.getAttribute('aria-checked'))).toEqual(['true', 'false'])
    expect(options[1]?.textContent).toContain('Not logged in')
    // Esc goes back to the full list without closing the menu.
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByTestId('composer-action-option').first()).toBeVisible()
  })

  it('picking another account on an idle chat switches at once', async () => {
    const { fake, sessionId } = await openChat()
    await pickWork()
    await until(() => switches(fake).length === 1)
    expect(switches(fake)[0]).toEqual([sessionId, 'work'])
    expect(document.querySelector('[data-testid="account-switch-prompt"]')).toBeNull()
  })

  it('a busy chat asks; Stop and switch switches', async () => {
    const { fake, sessionId } = await openChat()
    play(fake, sessionId, { status: 'busy' })
    await pickWork()
    await expect.element(page.getByTestId('account-switch-prompt')).toBeVisible()
    expect(document.body.textContent).toContain('Claude is still replying')
    expect(switches(fake)).toHaveLength(0)
    await userEvent.click(page.getByTestId('account-switch-now'))
    await until(() => switches(fake).length === 1)
    expect(switches(fake)[0]).toEqual([sessionId, 'work'])
  })

  it('Switch when it finishes waits for idle', async () => {
    const { fake, sessionId } = await openChat()
    play(fake, sessionId, { status: 'busy' })
    await pickWork()
    await userEvent.click(page.getByTestId('account-switch-later'))
    await expect.element(page.getByTestId('chat-status-switching')).toHaveTextContent('Switching to Work after this reply')
    expect(switches(fake)).toHaveLength(0)
    play(fake, sessionId, { status: 'idle' })
    await until(() => switches(fake).length === 1)
    expect(switches(fake)[0]).toEqual([sessionId, 'work'])
    expect(document.querySelector('[data-testid="chat-status-switching"]')).toBeNull()
  })

  it('sending a message cancels a waiting switch', async () => {
    const { fake, sessionId } = await openChat()
    play(fake, sessionId, { status: 'busy' })
    await pickWork()
    await userEvent.click(page.getByTestId('account-switch-later'))
    await expect.element(page.getByTestId('chat-status-switching')).toBeVisible()
    await userEvent.fill(page.getByTestId('composer-input'), 'never mind')
    await userEvent.keyboard('{Enter}')
    await until(() => fake.callsTo('chatSend').length === 1)
    expect(document.querySelector('[data-testid="chat-status-switching"]')).toBeNull()
    play(fake, sessionId, { status: 'idle' })
    await expect.element(page.getByTestId('composer-input')).toBeVisible()
    expect(switches(fake)).toHaveLength(0)
  })

  it('Don’t switch does nothing', async () => {
    const { fake, sessionId } = await openChat()
    play(fake, sessionId, { status: 'busy' })
    await pickWork()
    await userEvent.click(page.getByTestId('account-switch-none'))
    expect(document.querySelector('[data-testid="account-switch-prompt"]')).toBeNull()
    play(fake, sessionId, { status: 'idle' })
    await expect.element(page.getByTestId('composer-input')).toBeVisible()
    expect(switches(fake)).toHaveLength(0)
    expect(document.querySelector('[data-testid="chat-status-switching"]')).toBeNull()
  })

  it('the tab menu Account submenu switches a terminal session', async () => {
    const { fake } = await renderApp({}, twoAccounts)
    await userEvent.click(sidebarSession(TITLE))
    const tab = page.getByTestId('session-tab').first().element()
    const r = tab.getBoundingClientRect()
    tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 5, clientY: r.top + 5 }))
    await userEvent.click(page.getByTestId('context-menu-account'))
    const items = [...document.querySelectorAll('[data-testid^="context-menu-account-"]')]
    expect(items.map((i) => i.textContent)).toEqual(['Main', 'Work'])
    await userEvent.click(page.getByTestId('context-menu-account-work'))
    const id = fake.state.sessions.find((s) => s.title === TITLE)!.sessionId
    await until(() => switches(fake).length === 1)
    expect(switches(fake)[0]).toEqual([id, 'work'])
  })

  it('the tooltip names the account', async () => {
    await openChat()
    await expect.element(page.getByTestId('session-tab-label').first()).toHaveAttribute('title', `${TITLE}\nAccount: Main`)
  })
})
