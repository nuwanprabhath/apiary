import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { emptyChatState } from '@shared/domain/chat'
import { asSessionId } from '@shared/domain/ids'
import type { TranscriptMessage } from '@shared/domain/transcript'
import { renderApp } from './renderApp'
import { sidebarSession } from './helpers'

/** Another Claude session's message (a subagent's report back) in the chat: labelled, and folded when long. */
const TITLE = 'Fix CSV export bug'
const REPORT = ['I added Strapi integration tests for 1.0.10, 1.0.11 and 1.0.12.', '', ...Array.from({ length: 30 }, (_, i) => `- detail ${String(i)}`)].join('\n')

async function chatWith(messages: TranscriptMessage[]): Promise<void> {
  const { fake } = await renderApp({ settings: { transcriptChat: true } })
  await userEvent.click(sidebarSession(TITLE))
  await expect.element(page.getByTestId('chat-timeline')).toBeVisible()
  const sessionId = fake.state.sessions.find((s) => s.title === TITLE)!.sessionId
  const next = { ...emptyChatState(asSessionId(sessionId)), status: 'idle' as const, live: messages }
  fake.state.chats.set(sessionId, next)
  fake.emit('chatChanged', { kind: 'full', state: next })
}

/** The text of the (one) peer message, polled until it matches. */
async function shows(expected: RegExp): Promise<void> {
  await expect.poll(() => document.querySelector('[data-testid="peer-message"]')?.textContent ?? '').toMatch(expected)
}

const peer = (uuid: string, text: string): TranscriptMessage =>
  ({ uuid, role: 'user', timestampMs: null, isSidechain: false, blocks: [{ type: 'peer_message', from: 'general-purpose', text }] })

describe('a message from another Claude session', () => {
  it('a long one is folded to its first line, says who sent it, and opens and closes from its header', async () => {
    await chatWith([peer('p1', REPORT)])
    const message = page.getByTestId('peer-message')
    await expect.element(message).toBeVisible()
    await shows(/general-purpose agent/)
    await shows(/I added Strapi integration tests/)
    expect(message.element().textContent).not.toContain('detail 29')
    expect(message.element().getBoundingClientRect().height).toBeLessThan(60)

    await userEvent.click(page.getByTestId('peer-message-toggle'))
    await expect.element(page.getByTestId('peer-message-toggle')).toHaveAttribute('aria-expanded', 'true')
    await shows(/detail 29/)

    await userEvent.click(page.getByTestId('peer-message-toggle'))
    expect(message.element().textContent).not.toContain('detail 29')
  })

  it('a short one is shown whole, with nothing to open', async () => {
    await chatWith([peer('p2', 'Done. All 25 tests pass.')])
    await shows(/All 25 tests pass/)
    expect(document.querySelector('[data-testid="peer-message-toggle"]')).toBeNull()
  })

  it('is not your own message: it is never drawn as a prompt you sent', async () => {
    await chatWith([peer('p3', REPORT)])
    await expect.element(page.getByTestId('peer-message')).toBeVisible()
    expect(document.querySelector('[data-testid="chat-user"][data-key="p3"]')).toBeNull()
  })
})
