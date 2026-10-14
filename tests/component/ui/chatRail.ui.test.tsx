import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { emptyChatState } from '@shared/domain/chat'
import { asSessionId } from '@shared/domain/ids'
import { renderApp } from '../renderApp'
import { sidebarSession } from '../helpers'
import { reviewUi } from './review'

/** The working line and the status lines under the conversation share the timeline's dot rail. */
const TITLE = 'Fix CSV export bug'

async function openChat(patch: object): Promise<void> {
  const { fake } = await renderApp({ settings: { transcriptChat: true } })
  await userEvent.click(sidebarSession(TITLE))
  await expect.element(page.getByTestId('chat-timeline')).toBeVisible()
  const sessionId = fake.state.sessions.find((s) => s.title === TITLE)!.sessionId
  const next = { ...(fake.state.chats.get(sessionId) ?? { ...emptyChatState(asSessionId(sessionId)), status: 'idle' as const }), ...patch }
  fake.state.chats.set(sessionId, next)
  fake.emit('chatChanged', next)
}

const reply = { uuid: 'a1', role: 'assistant' as const, timestampMs: null, isSidechain: false, blocks: [{ type: 'text' as const, text: 'Looking into the export.' }] }

describe('UI chat rail', () => {
  it('idle, with the last turn, a recap and a background task', async () => {
    await openChat({
      live: [reply],
      backgroundTasks: [{ taskId: 'b2', description: 'Run the e2e suite' }],
      lastTurn: { durationMs: 33000, endedAt: Date.parse('2026-10-02T09:23:00') },
    })
    await expect.element(page.getByTestId('chat-status-tasks')).toBeVisible()
    await reviewUi('chat rail idle', { widths: [1000, 1400], themes: ['paper', 'glass'] })
  })

  it('working', async () => {
    await openChat({ live: [reply], status: 'busy', turnStartedAt: Date.now() })
    await expect.element(page.getByTestId('chat-working')).toBeVisible()
    await reviewUi('chat rail working', { widths: [1000, 1400], themes: ['paper', 'glass'] })
  })
})
