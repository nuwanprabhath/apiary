import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { emptyChatState } from '@shared/domain/chat'
import { asSessionId } from '@shared/domain/ids'
import type { TranscriptMessage } from '@shared/domain/transcript'
import { renderApp } from '../renderApp'
import { mouse, sidebarSession, until } from '../helpers'
import { reviewUi } from './review'

/** A subagent's report back in the chat: folded (long), open, and short. */
const TITLE = 'Fix CSV export bug'
const LONG = ['I added Strapi integration tests that sync the captured /bulk bodies from webapps 1.0.10, 1.0.11 and 1.0.12 to the new Core. All 25 new tests pass.', '', '**Files**', ...Array.from({ length: 8 }, (_, i) => `- \`species-info-compat/legacy-1.0.${String(i)}-bodies.json\``)].join('\n')
const peer = (uuid: string, text: string): TranscriptMessage =>
  ({ uuid, role: 'user', timestampMs: Date.parse('2026-10-20T17:21:00'), isSidechain: false, blocks: [{ type: 'peer_message', from: 'general-purpose', text }] })

async function open(): Promise<void> {
  const { fake } = await renderApp({ settings: { transcriptChat: true } })
  await userEvent.click(sidebarSession(TITLE))
  await expect.element(page.getByTestId('chat-timeline')).toBeVisible()
  const sessionId = fake.state.sessions.find((s) => s.title === TITLE)!.sessionId
  const next = { ...emptyChatState(asSessionId(sessionId)), status: 'idle' as const, live: [peer('p1', LONG), peer('p2', 'Done. Committed as 30fb0e9.')] }
  fake.state.chats.set(sessionId, next)
  fake.emit('chatChanged', { kind: 'full', state: next })
  await until(() => document.querySelectorAll('[data-testid="peer-message"]').length === 2)
  await mouse.move(1, 1)
  await until(() => document.querySelector('.hover-card') === null)
}

const timeline = (): Element | null => document.querySelector('[data-testid="chat-timeline"]')

describe('UI peer message', () => {
  it('a long report folded, and a short one', async () => {
    await open()
    await reviewUi('peer message folded', { widths: [1000], within: timeline })
  })

  it('the long report opened', async () => {
    await open()
    await reviewUi('peer message open', {
      widths: [1000],
      within: timeline,
      open: async () => {
        const toggle = document.querySelector<HTMLButtonElement>('[data-testid="peer-message-toggle"]')
        if (toggle?.getAttribute('aria-expanded') === 'false') toggle.click()
        await until(() => toggle?.getAttribute('aria-expanded') === 'true')
      },
    })
  })
})
