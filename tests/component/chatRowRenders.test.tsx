import { describe, it, expect } from 'vitest'
import { flushSync } from 'react-dom'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { nextFrames, sidebarSession, until } from './helpers'
import { trackRenders } from './renderTracker'
import { emptyChatState, type ChatState } from '@shared/domain/chat'
import { asSessionId } from '@shared/domain/ids'
import type { TranscriptMessage } from '@shared/domain/transcript'

const TITLE = 'Fix CSV export bug'

const said = (uuid: string, role: 'user' | 'assistant', text: string): TranscriptMessage =>
  ({ uuid, role, timestampMs: null, isSidechain: false, blocks: [{ type: 'text', text }] })

const stream = (text: string): ChatState['streaming'] =>
  ({ text, thinking: false, thinkingSince: null, thinkingTokens: null })

describe('a chat update renders only what changed', () => {
  it('streamed words re-render no existing row', async () => {
    const { fake } = await renderApp({ settings: { transcriptChat: true } })
    await userEvent.click(sidebarSession(TITLE))
    await expect.element(page.getByTestId('chat-timeline')).toBeVisible()
    const sessionId = fake.state.sessions.find((s) => s.title === TITLE)!.sessionId
    const play = (patch: Partial<ChatState>): void => {
      const next = { ...(fake.state.chats.get(sessionId) ?? { ...emptyChatState(asSessionId(sessionId)), status: 'idle' as const }), ...patch }
      fake.state.chats.set(sessionId, next)
      fake.emit('chatChanged', { kind: 'full', state: next })
    }
    const live = [1, 2, 3, 4].flatMap((n) => [
      said(`u${String(n)}`, 'user', `question ${String(n)}`),
      said(`a${String(n)}`, 'assistant', `answer ${String(n)}`),
    ])
    play({ status: 'busy', turnStartedAt: Date.now(), live, streaming: stream('The') })
    await until(() => document.querySelectorAll('[data-testid="chat-text"]').length === 4)

    const renders = trackRenders('Item', true)
    for (const text of ['The parser', 'The parser reads', 'The parser reads the file']) {
      play({ streaming: stream(text) })
      await expect.poll(() => document.querySelector('[data-testid="chat-streaming"]')?.textContent?.trim()).toBe(text)
    }
    renders.stop()
    expect([...renders.read()]).toEqual([])
  })

  it('following the tail reads the transcript layout once per frame, not per update', async () => {
    const { fake } = await renderApp({ settings: { transcriptChat: true } })
    await userEvent.click(sidebarSession(TITLE))
    await expect.element(page.getByTestId('chat-timeline')).toBeVisible()
    const sessionId = fake.state.sessions.find((s) => s.title === TITLE)!.sessionId
    const scroller = document.querySelector('.transcript')!
    let reads = 0
    const real = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight')!
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, get: () => { reads++; return (real.get as () => number).call(scroller) } })
    await nextFrames(3)
    reads = 0
    // Six updates each committed on its own, inside one frame.
    for (let i = 1; i <= 6; i++) {
      const next = { ...emptyChatState(asSessionId(sessionId)), status: 'busy' as const, streaming: stream('word '.repeat(i)) }
      fake.state.chats.set(sessionId, next)
      flushSync(() => { fake.emit('chatChanged', { kind: 'full', state: next }) })
    }
    await expect.poll(() => document.querySelector('[data-testid="chat-streaming"]')?.textContent?.trim()).toBe('word '.repeat(6).trim())
    await nextFrames(3)
    expect(reads).toBeGreaterThan(0)
    expect(reads).toBeLessThanOrEqual(2)
  })
})
