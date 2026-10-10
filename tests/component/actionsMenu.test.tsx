import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { sidebarSession, until } from './helpers'
import type { FakeApiary } from './fakeApiary'
import { emptyChatState, type ChatCommand } from '@shared/domain/chat'
import { asSessionId } from '@shared/domain/ids'

const COMMANDS: ChatCommand[] = [
  { name: 'compact', description: 'Clear history but keep a summary', argumentHint: '[instructions]' },
  { name: 'review', description: 'Review a pull request', argumentHint: '[pr-number]' },
  { name: 'clear', description: 'Clear the conversation', argumentHint: '' },
]

const count = (testId: string): number => document.querySelectorAll(`[data-testid="${testId}"]`).length
const text = (testId: string): string => document.querySelector(`[data-testid="${testId}"]`)?.textContent ?? ''

async function openChat(): Promise<FakeApiary> {
  const { fake } = await renderApp({ settings: { transcriptChat: true } })
  await userEvent.click(sidebarSession('Fix CSV export bug'))
  await expect.element(page.getByTestId('chat-timeline')).toBeVisible()
  const id = fake.state.sessions.find((s) => s.title === 'Fix CSV export bug')?.sessionId ?? ''
  const next = { ...emptyChatState(asSessionId(id)), status: 'idle' as const, commands: COMMANDS }
  fake.state.chats.set(id, next)
  fake.emit('chatChanged', next)
  await until(() => count('composer-input') === 1)
  return fake
}

describe('the "/" actions menu', () => {
  it('typing "/" opens the same menu with the filter showing the typed text, and focus stays in the composer', async () => {
    await openChat()
    const input = page.getByTestId('composer-input')
    await userEvent.click(input)
    await userEvent.keyboard('/re')
    await until(() => count('composer-command-menu') === 1)
    expect(document.querySelector<HTMLInputElement>('[data-testid="composer-command-search"]')?.value).toBe('re')
    expect(document.activeElement).toBe(input.element())

    await userEvent.keyboard('{ArrowDown}{Enter}')
    await expect.element(input).toHaveValue('/review ')
    await until(() => count('composer-command-menu') === 0)
  })

  it('Escape closes the typed menu and leaves the text; Enter with no match sends the text as typed', async () => {
    const fake = await openChat()
    await userEvent.click(page.getByTestId('composer-input'))
    await userEvent.keyboard('/re{Escape}')
    await until(() => count('composer-command-menu') === 0)
    await expect.element(page.getByTestId('composer-input')).toHaveValue('/re')

    await userEvent.keyboard('zzzz')
    await until(() => count('composer-command-menu') === 1)
    await until(() => text('composer-command-menu').includes('No matching actions'))
    await userEvent.keyboard('{Enter}')
    await until(() => fake.callsTo('chatSend').length === 1)
  })

  it('the button opens the same menu with the filter focused, both sections, and the selected row in the footer', async () => {
    await openChat()
    await userEvent.click(page.getByTestId('composer-commands'))
    await until(() => count('composer-command-menu') === 1)
    expect(document.activeElement).toBe(page.getByTestId('composer-command-search').element())
    expect(count('composer-setting-option')).toBe(1)
    expect(count('composer-command-option')).toBe(3)
    expect(text('composer-command-footer')).toContain('Show tool calls')

    await userEvent.keyboard('{ArrowDown}')
    await until(() => text('composer-command-footer').includes('/compact [instructions] — Clear history but keep a summary'))
    expect(document.querySelector('[data-name="compact"]')?.textContent).not.toContain('[instructions]')
  })

  it('a filter with no match says so, and a section with no match disappears', async () => {
    await openChat()
    await userEvent.click(page.getByTestId('composer-commands'))
    await userEvent.fill(page.getByTestId('composer-command-search'), 'clear')
    await until(() => count('composer-setting-option') === 0)
    expect(text('composer-command-menu')).not.toContain('Chat settings')
    await userEvent.fill(page.getByTestId('composer-command-search'), 'qqqqq')
    await until(() => text('composer-command-menu').includes('No matching actions'))
  })

  it('starts every description at one x, past the longest name', async () => {
    await openChat()
    await userEvent.click(page.getByTestId('composer-input'))
    await userEvent.keyboard('/')
    await until(() => count('composer-command-option') >= 3)
    const rows = [...document.querySelectorAll('[data-testid="composer-command-option"]')]
    const lefts = rows.map((r) => r.querySelector('.chat-command-desc')?.getBoundingClientRect().left ?? -1)
    const rights = rows.map((r) => r.querySelector('.chat-command-name')?.getBoundingClientRect().right ?? 0)
    expect(new Set(lefts.map(Math.round)).size).toBe(1)
    expect(lefts[0]).toBeGreaterThan(Math.max(...rights))
  })
})
