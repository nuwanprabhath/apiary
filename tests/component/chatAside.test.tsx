import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { emptyChatState } from '@shared/domain/chat'
import { asSessionId } from '@shared/domain/ids'
import { renderApp } from './renderApp'
import { sidebarSession, until } from './helpers'
import type { FakeApiary } from './fakeApiary'

/** `/btw`: side questions in a thread of their own over the message box, answered apart from the conversation. */
const TITLE = 'Fix CSV export bug'
const OTHER = 'Add worktree switcher'

async function openChat(opts: { busy?: boolean; chat?: boolean } = {}): Promise<{ fake: FakeApiary; sessionId: string }> {
  const { fake } = await renderApp({ settings: { transcriptChat: opts.chat ?? true } })
  await userEvent.click(sidebarSession(TITLE))
  const sessionId = fake.state.sessions.find((s) => s.title === TITLE)!.sessionId
  if (opts.busy === true) {
    const next = { ...emptyChatState(asSessionId(sessionId)), status: 'busy' as const, turnStartedAt: Date.now() }
    fake.state.chats.set(sessionId, next)
    fake.emit('chatChanged', { kind: 'full', state: next })
    await expect.element(page.getByTestId('chat-working')).toBeVisible()
  }
  return { fake, sessionId }
}

async function inBox(text: string): Promise<void> {
  await userEvent.fill(page.getByTestId('composer-input'), text)
  await userEvent.keyboard('{Enter}')
}

const answers = (): string[] => [...document.querySelectorAll('[data-testid="chat-aside-answer"]')].map((e) => (e.textContent ?? '').trim())
const questions = (): string[] => [...document.querySelectorAll('[data-testid="chat-aside-question"]')].map((e) => e.textContent ?? '')
const cardOut = (): boolean => document.querySelector('[data-testid="chat-aside"]') !== null

describe('/btw', () => {
  it('asks the side question in a card over the message box, sends nothing to the chat, and leaves the cursor in the card', async () => {
    const { fake, sessionId } = await openChat()
    await inBox('/btw what does mergeLive do?')
    await expect.poll(answers).toEqual(['An aside about: what does mergeLive do?'])
    expect(fake.callsTo('chatAside')).toEqual([[sessionId, 'what does mergeLive do?', []]])
    expect(fake.callsTo('chatSend')).toEqual([])
    expect(fake.callsTo('chatStart')).toEqual([])
    expect((page.getByTestId('composer-input').element() as HTMLTextAreaElement).value).toBe('')
    expect(document.activeElement).toBe(page.getByTestId('chat-aside-input').element())
    expect(document.querySelector('[data-testid="chat-timeline"]')?.textContent ?? '').not.toContain('mergeLive')
  })

  it('a follow-up typed in the card stays in the thread, carrying the earlier answer, and never reaches the chat', async () => {
    const { fake, sessionId } = await openChat()
    await inBox('/btw what is the context window?')
    await expect.poll(answers).toHaveLength(1)
    await userEvent.fill(page.getByTestId('chat-aside-input'), 'and how much is used?')
    await userEvent.keyboard('{Enter}')
    await expect.poll(answers).toEqual(['An aside about: what is the context window?', 'An aside about: and how much is used? (after 1 earlier)'])
    expect(fake.callsTo('chatAside')[1]).toEqual([sessionId, 'and how much is used?', [{ question: 'what is the context window?', answer: 'An aside about: what is the context window?' }]])
    expect(fake.callsTo('chatSend')).toEqual([])
    expect((page.getByTestId('chat-aside-input').element() as HTMLTextAreaElement).value).toBe('')
  })

  it('can be asked while Claude is working, without queueing, interrupting or joining the turn', async () => {
    const { fake } = await openChat({ busy: true })
    await inBox('/btw is this safe?')
    await expect.poll(answers).toEqual(['An aside about: is this safe?'])
    expect(fake.callsTo('chatSend')).toEqual([])
    expect(fake.callsTo('chatInterrupt')).toEqual([])
    expect(document.querySelectorAll('[data-testid="chat-queued"]')).toHaveLength(0)
    await expect.element(page.getByTestId('chat-working')).toBeVisible()
  })

  it('Escape in the message box still stops Claude, and leaves the side thread open', async () => {
    const { fake } = await openChat({ busy: true })
    await inBox('/btw first')
    await expect.poll(answers).toHaveLength(1)
    await userEvent.click(page.getByTestId('composer-input'))
    await userEvent.keyboard('{Escape}')
    await until(() => fake.callsTo('chatInterrupt').length === 1)
    expect(cardOut()).toBe(true)
  })

  it('says why when one cannot be answered', async () => {
    const { fake } = await openChat()
    fake.override('chatAside', async () => { throw new Error('Claude could not be run (exit 1).') })
    await inBox('/btw anything')
    await expect.poll(answers).toEqual(['Claude could not be run (exit 1).'])
  })

  it('closes with Escape inside it or ×, and /btw alone brings the thread back as it was left, after a tab switch too', async () => {
    await openChat()
    await inBox('/btw first')
    await expect.poll(answers).toHaveLength(1)
    await userEvent.keyboard('{Escape}')
    await until(() => !cardOut())
    await inBox('/btw')
    await expect.poll(questions).toEqual(['first'])
    await userEvent.click(page.getByTestId('chat-aside-close'))
    await until(() => !cardOut())
    await userEvent.click(sidebarSession(OTHER))
    await userEvent.click(sidebarSession(TITLE))
    expect(cardOut()).toBe(false)
    await inBox('/btw')
    await expect.poll(questions).toEqual(['first'])
  })

  it('the thread is still there after a restart, and the bin clears it', async () => {
    await openChat()
    await inBox('/btw remember me')
    await expect.poll(answers).toHaveLength(1)
    // A restart: a fresh app over the same storage.
    await openChat()
    expect(cardOut()).toBe(false)
    await inBox('/btw')
    await expect.poll(questions).toEqual(['remember me'])
    await userEvent.click(page.getByTestId('chat-aside-clear'))
    await expect.poll(questions).toEqual([])
    await openChat()
    await inBox('/btw')
    await expect.poll(() => document.querySelector('[data-testid="chat-aside-thread"]')?.textContent ?? '').toContain('without interrupting Claude')
  })

  it('is offered in the "/" menu, and choosing it opens the thread with the cursor in its own box', async () => {
    const { fake } = await openChat()
    await userEvent.fill(page.getByTestId('composer-input'), '/bt')
    await expect.poll(() => [...document.querySelectorAll('[data-testid="composer-command-option"]')].map((e) => e.getAttribute('data-name')))
      .toContain('btw')
    await userEvent.keyboard('{Enter}')
    await until(cardOut)
    await until(() => document.activeElement === page.getByTestId('chat-aside-input').element())
    expect((page.getByTestId('composer-input').element() as HTMLTextAreaElement).value).toBe('')
    expect(fake.callsTo('chatSend')).toEqual([])
  })

  it('in a terminal session goes to the terminal, whose Claude Code has /btw of its own', async () => {
    const { fake } = await openChat({ chat: false })
    await inBox('/btw what is this?')
    await until(() => fake.callsTo('sendPrompt').length === 1)
    expect(fake.callsTo('chatAside')).toEqual([])
  })
})
