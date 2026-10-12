import { describe, it, expect } from 'vitest'
import { userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { message } from './fakeApiary'
import { sidebarSession, until } from './helpers'

const TS = new Date(2026, 9, 10, 10, 29).getTime()
const MINUTE = 60_000

async function open(chat: boolean, stamps: (number | null)[]): Promise<void> {
  await renderApp({
    settings: { transcriptChat: chat },
    sessions: [{
      sessionId: 'timed',
      title: 'Timed session',
      projectPath: '/fixture/repo-c',
      messages: [
        message('u1', 'user', 'list the sources', { timestampMs: stamps[0] }),
        message('a1', 'assistant', 'Two folders.', { timestampMs: stamps[1] }),
        message('a2', 'assistant', 'And a second reply.', { timestampMs: stamps[2] }),
      ],
    }],
  })
  await userEvent.click(sidebarSession('Timed session'))
  await until(() => document.querySelector('[data-testid="transcript"]') !== null)
}

const times = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-testid="message-time"]')]
const rect = (el: Element): DOMRect => el.getBoundingClientRect()
const intersects = (a: DOMRect, b: DOMRect): boolean =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

describe.each([[false], [true]] as const)('message times (chat: %s)', (chat) => {
  it('shows a time on every user message and every reply, even within one minute', async () => {
    await open(chat, [TS, TS + 2 * MINUTE, TS + 2 * MINUTE + 10_000])
    await until(() => times().length >= 3)
    expect(times()).toHaveLength(3)
    const [user, reply, second] = times()
    expect(user.textContent).toMatch(/10:29/)
    expect(reply.textContent).toMatch(/10:31/)
    expect(second.textContent).toMatch(/10:31/)
    expect(user.getAttribute('datetime')).toBe(new Date(TS).toISOString())
    expect(user.title).not.toBe('')
    expect(getComputedStyle(reply).opacity).toBe('1')
    expect(getComputedStyle(reply).position).not.toBe('absolute')
  })

  it('shows no time for a message without a timestamp', async () => {
    await open(chat, [null, null, null])
    expect(times()).toEqual([])
  })
})

describe('message time placement', () => {
  it('keeps the role label on the same top as the text in the plain transcript', async () => {
    await open(false, [TS, TS + 2 * MINUTE, TS + 4 * MINUTE])
    await until(() => times().length >= 3)
    for (const row of document.querySelectorAll('[data-testid="message"][data-role="user"]')) {
      const time = row.querySelector('[data-testid="message-time"]')!
      const role = row.querySelector('.message-role')!
      const text = row.querySelector('.message-body .text-block, .message-body .markdown')!
      expect(rect(time).bottom).toBeLessThanOrEqual(rect(role).top + 4)
      // The role label has 2px of top padding; its text starts where the body's first line does.
      expect(rect(role).top).toBe(rect(text).top)
    }
  })

  it.each([[false], [true]] as const)('puts a reply time on the first line of its text, not on its own line (chat: %s)', async (chat) => {
    await open(chat, [TS, TS + 2 * MINUTE, TS + 4 * MINUTE])
    await until(() => times().length >= 3)
    const body = document.querySelector(chat ? '[data-testid="chat-text"] .chat-row-body' : '[data-role="assistant"] .message-body')!
    const time = body.querySelector('[data-testid="message-time"]')!
    const text = body.querySelector('.markdown, .text-block')!
    const line = parseFloat(getComputedStyle(text).lineHeight)
    expect(body.contains(time)).toBe(true)
    expect(rect(time).top).toBeGreaterThanOrEqual(rect(text).top - 1)
    expect(rect(time).top).toBeLessThan(rect(text).top + line)
  })

  it('draws no chat time over a bubble, a reply or another time', async () => {
    await open(true, [TS, TS + 2 * MINUTE, TS + 4 * MINUTE])
    await until(() => times().length >= 3)
    // A reply's time lives inside its row, beside the text (the line test above), so only a bubble can be covered.
    const boxes = [...document.querySelectorAll('[data-testid="chat-user"]')]
    const all = times()
    const hits = all.flatMap((t) => [
      ...boxes.filter((box) => intersects(rect(t), rect(box))),
      ...all.filter((other) => other !== t && intersects(rect(t), rect(other))),
    ])
    expect(hits).toEqual([])
  })
})
