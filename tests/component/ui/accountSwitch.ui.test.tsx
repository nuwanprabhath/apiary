import { describe, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { emptyChatState } from '@shared/domain/chat'
import { MAIN_ACCOUNT_ID } from '@shared/domain/accounts'
import { asAccountId, asSessionId } from '@shared/domain/ids'
import { renderApp } from '../renderApp'
import { sidebarSession, until } from '../helpers'
import type { FakeApiary } from '../fakeApiary'
import { reviewUi } from './review'

/** Switching a session's account: the "/" menu row and list, the tab submenu, the busy question, the status line. */
const WORK = asAccountId('work')
const TITLE = 'Fix CSV export bug'
const WIDTHS = { widths: [1000] as [1000] }

const exists = (testId: string): boolean => document.querySelector(`[data-testid="${testId}"]`) !== null

async function openChat(): Promise<{ fake: FakeApiary; id: string }> {
  const { fake } = await renderApp({ settings: { transcriptChat: true } }, (f) => {
    f.state.accounts = {
      accounts: [
        { id: MAIN_ACCOUNT_ID, label: 'Main', email: 'someone.with.a.long.address@example.test', isMain: true },
        { id: WORK, label: 'Work account with a rather long label', email: null, isMain: false },
      ],
      defaultId: MAIN_ACCOUNT_ID,
    }
  })
  await userEvent.click(sidebarSession(TITLE))
  await until(() => exists('chat-timeline'))
  const id = fake.state.sessions.find((s) => s.title === TITLE)?.sessionId ?? ''
  const next = { ...emptyChatState(asSessionId(id)), status: 'idle' as const }
  fake.state.chats.set(id, next)
  fake.emit('chatChanged', { kind: 'full', state: next })
  await until(() => exists('composer-input'))
  return { fake, id }
}

const busy = (fake: FakeApiary, id: string): void => {
  const next = { ...emptyChatState(asSessionId(id)), status: 'busy' as const }
  fake.state.chats.set(id, next)
  fake.emit('chatChanged', { kind: 'full', state: next })
}

const openMenu = async (): Promise<void> => {
  if (!exists('composer-command-menu')) await userEvent.click(page.getByTestId('composer-commands'))
  await until(() => exists('composer-command-menu'))
}

describe('UI: switching an account', () => {
  it('account row in the menu', async () => {
    await openChat()
    await reviewUi('account row in the menu', { ...WIDTHS, open: openMenu, close: () => userEvent.keyboard('{Escape}') })
  })

  it('account list in the menu', async () => {
    await openChat()
    await reviewUi('account list in the menu', {
      ...WIDTHS,
      open: async () => {
        await openMenu()
        if (!exists('composer-account-option')) await userEvent.click(page.getByTestId('composer-action-option').first())
        await until(() => exists('composer-account-option'))
      },
      close: async () => {
        await userEvent.keyboard('{Escape}')
        await userEvent.keyboard('{Escape}')
      },
    })
  })

  it('account submenu on the tab', async () => {
    await openChat()
    await reviewUi('account submenu on the tab', {
      ...WIDTHS,
      open: async () => {
        const tab = page.getByTestId('session-tab').first().element()
        const r = tab.getBoundingClientRect()
        tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 5, clientY: r.top + 5 }))
        await until(() => exists('tab-menu'))
        await userEvent.click(page.getByTestId('context-menu-account'))
        await until(() => exists('context-menu-account-work'))
      },
      close: () => userEvent.keyboard('{Escape}'),
    })
  })

  it('busy question', async () => {
    const { fake, id } = await openChat()
    busy(fake, id)
    await userEvent.click(page.getByTestId('composer-commands'))
    await userEvent.click(page.getByTestId('composer-action-option').first())
    await userEvent.click(page.getByTestId('composer-account-option').nth(1))
    await until(() => exists('account-switch-prompt'))
    await reviewUi('busy question', { ...WIDTHS, open: async () => { await until(() => exists('account-switch-prompt')) } })
  })

  it('account pill and waiting line', async () => {
    const { fake, id } = await openChat()
    await reviewUi('account pill in the status line', { ...WIDTHS, open: async () => { await until(() => exists('chat-status-account')) } })
    busy(fake, id)
    await userEvent.click(page.getByTestId('composer-commands'))
    await userEvent.click(page.getByTestId('composer-action-option').first())
    await userEvent.click(page.getByTestId('composer-account-option').nth(1))
    await userEvent.click(page.getByTestId('account-switch-later'))
    await reviewUi('switching after this reply', { ...WIDTHS, open: async () => { await until(() => exists('chat-status-switching')) } })
  })
})
