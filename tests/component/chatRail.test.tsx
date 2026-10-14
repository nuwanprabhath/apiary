import { describe, it, expect, afterEach } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { sidebarSession } from './helpers'
import { emptyChatState } from '@shared/domain/chat'
import { asSessionId } from '@shared/domain/ids'

/** The timeline's dots, the working line's glyph and the status lines' glyphs share one left rail. */
const TITLE = 'Fix CSV export bug'

const centreX = (el: Element): number => {
  const r = el.getBoundingClientRect()
  return r.left + r.width / 2
}

afterEach(() => { document.documentElement.style.removeProperty('--density') })

describe.each([0.8, 1])('chat rail at density %s', (density) => {
  it('puts the working and status glyphs on the dot column', async () => {
    document.documentElement.style.setProperty('--density', String(density))
    const { fake } = await renderApp({ settings: { transcriptChat: true } })
    await userEvent.click(sidebarSession(TITLE))
    await expect.element(page.getByTestId('chat-timeline')).toBeVisible()
    const sessionId = fake.state.sessions.find((s) => s.title === TITLE)!.sessionId
    const send = (patch: object): void => {
      const next = { ...(fake.state.chats.get(sessionId) ?? { ...emptyChatState(asSessionId(sessionId)), status: 'idle' as const }), ...patch }
      fake.state.chats.set(sessionId, next)
      fake.emit('chatChanged', next)
    }
    send({
      live: [{ uuid: 'a1', role: 'assistant', timestampMs: null, isSidechain: false, blocks: [{ type: 'text', text: 'Hello there' }] }],
      backgroundTasks: [{ taskId: 'b2', description: 'Run the e2e suite' }],
      lastTurn: { durationMs: 33000, endedAt: Date.parse('2026-10-02T09:23:00') },
    })
    await expect.poll(() => document.querySelector('[data-testid="chat-status-tasks"]')).not.toBeNull()
    const dot = centreX(document.querySelector('.chat-timeline .chat-dot')!)
    for (const g of document.querySelectorAll('.chat-status-glyph')) expect(centreX(g)).toBeCloseTo(dot, 0)
    send({ status: 'busy', turnStartedAt: Date.now() })
    await expect.poll(() => document.querySelector('.chat-working-glyph')).not.toBeNull()
    expect(centreX(document.querySelector('.chat-working-glyph')!)).toBeCloseTo(dot, 0)
  })
})
