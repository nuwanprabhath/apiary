import { describe, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { emptyChatState, type ChatCommand } from '@shared/domain/chat'
import { asSessionId } from '@shared/domain/ids'
import { renderApp } from '../renderApp'
import { sidebarSession, until } from '../helpers'
import { reviewUi } from './review'

/** The "/" actions menu, opened by the button and by typing "/", with a realistically long command list. */
const TOPICS = ['compact', 'review', 'init', 'memory', 'model', 'config', 'cost', 'doctor', 'help', 'login']
const COMMANDS: ChatCommand[] = Array.from({ length: 44 }, (_, i) => {
  const base = TOPICS[i % TOPICS.length] ?? 'cmd'
  return {
    name: i < TOPICS.length ? base : `${base}-${String(i)}`,
    description: 'Clear conversation history but keep a summary in context, optionally focused on what you tell it to keep',
    argumentHint: i % 3 === 0 ? '[a long optional argument hint] [--another-flag value]' : '',
  }
})

const press = async (keys: string): Promise<void> => { await userEvent.keyboard(keys) }
const menuOpen = (): boolean => document.querySelector('[data-testid="composer-command-menu"]') !== null

async function openChat(): Promise<void> {
  const { fake } = await renderApp({ settings: { transcriptChat: true } })
  await userEvent.click(sidebarSession('Fix CSV export bug'))
  await until(() => document.querySelector('[data-testid="chat-timeline"]') !== null)
  const id = fake.state.sessions.find((s) => s.title === 'Fix CSV export bug')?.sessionId ?? ''
  const next = { ...emptyChatState(asSessionId(id)), status: 'idle' as const, commands: COMMANDS }
  fake.state.chats.set(id, next)
  fake.emit('chatChanged', next)
  await until(() => document.querySelector('[data-testid="composer-input"]') !== null)
}

const fromButton = async (): Promise<void> => {
  if (!menuOpen()) await userEvent.click(page.getByTestId('composer-commands'))
  await until(menuOpen)
}

describe('UI: the actions menu', () => {
  it('actions menu open from button', async () => {
    await openChat()
    await reviewUi('actions menu open from button', { open: fromButton, close: () => press('{Escape}') })
  })

  it('actions menu typed slash', async () => {
    await openChat()
    await reviewUi('actions menu typed slash', {
      open: async () => {
        if (menuOpen()) return
        await userEvent.fill(page.getByTestId('composer-input'), '/re')
        await until(menuOpen)
      },
      close: async () => { await userEvent.fill(page.getByTestId('composer-input'), '') },
    })
  })

  it('actions menu no match', async () => {
    await openChat()
    await reviewUi('actions menu no match', {
      open: async () => {
        await fromButton()
        await userEvent.fill(page.getByTestId('composer-command-search'), 'zzzzqq')
      },
      close: () => press('{Escape}'),
    })
  })

  it('actions menu open from button, narrow', async () => {
    await openChat()
    // Audited inside the menu: at 620px the composer's own Send button is cut off by its row, which
    // is not this menu's (reported to the lead).
    await reviewUi('actions menu open from button narrow', {
      widths: [620],
      open: fromButton,
      close: () => press('{Escape}'),
      within: () => document.querySelector('[data-testid="composer-command-menu"]'),
    })
  })
})
