import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from '../renderApp'
import { sidebarSession, until } from '../helpers'
import { emptyChatState } from '@shared/domain/chat'
import { asSessionId } from '@shared/domain/ids'
import { reviewUi } from './review'

/** The model menu of a chat running a 1M-context model: the list and the effort row under it. */
const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

describe('UI: the model picker', () => {
  it('open menu with the effort row', async () => {
    const { fake } = await renderApp({ settings: { transcriptChat: true } })
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await expect.element(page.getByTestId('chat-timeline')).toBeVisible()
    const session = fake.state.sessions.find((s) => s.title === 'Fix CSV export bug')!
    const next = {
      ...emptyChatState(asSessionId(session.sessionId)),
      status: 'idle' as const,
      model: 'claude-opus-5-5[1m]',
      effort: 'medium' as const,
      models: [
        { value: 'default', resolvedModel: 'claude-opus-5-5', displayName: 'Default (recommended)', description: 'Opus 5.5 · Best for everyday work', efforts: [...LEVELS] },
        { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus 5.5', description: 'For complex work', efforts: [...LEVELS] },
        { value: 'haiku', resolvedModel: 'claude-haiku-4-5-20251001', displayName: 'Haiku 4.5', description: 'Fastest', efforts: [] },
      ],
    }
    fake.state.chats.set(session.sessionId, next)
    fake.emit('chatChanged', next)
    await until(() => document.querySelector('[data-testid="composer-model-pill"]')?.textContent?.includes('Medium') === true)
    await reviewUi('model menu with effort', {
      open: async () => {
        if (document.querySelector('[data-testid="composer-model-menu"]') === null) {
          await userEvent.click(page.getByTestId('composer-model-pill'))
        }
        await expect.element(page.getByTestId('composer-effort')).toBeVisible()
      },
      close: () => userEvent.keyboard('{Escape}'),
    })
  })
})
