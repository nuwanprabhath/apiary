import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { emptyChatState } from '@shared/domain/chat'
import { asSessionId } from '@shared/domain/ids'
import { renderApp } from '../renderApp'
import { sidebarSession, until } from '../helpers'
import { reviewUi } from './review'

/** Reduced motion: every running state keeps a still cue, and the Animations control is in Themes. */
const TITLE = 'Fix CSV export bug'

describe('UI reduced motion', () => {
  it('a busy chat: the working line, a running tab and a running session stay legible without motion', async () => {
    const { fake } = await renderApp({ settings: { transcriptChat: true, motion: 'reduced' } })
    await userEvent.click(sidebarSession(TITLE))
    await expect.element(page.getByTestId('chat-timeline')).toBeVisible()
    const sessionId = fake.state.sessions.find((s) => s.title === TITLE)!.sessionId
    const next = { ...emptyChatState(asSessionId(sessionId)), status: 'busy' as const, turnStartedAt: Date.now() }
    fake.state.chats.set(sessionId, next)
    fake.emit('chatChanged', { kind: 'full', state: next })
    await expect.element(page.getByTestId('chat-working')).toBeVisible()
    await until(() => document.documentElement.dataset.motion === 'reduced')
    await reviewUi('motion reduced busy chat', { widths: [1000, 1400], themes: ['default', 'glass'] })
  })

  it('the Animations control in Themes', async () => {
    const { fake } = await renderApp({ settings: { motion: 'auto' } })
    fake.emit('openSettingsDialog')
    await until(() => document.querySelector('[data-testid="settings-dialog"]') !== null)
    await userEvent.click(page.getByTestId('settings-nav-themes'))
    await expect.element(page.getByTestId('setting-motion')).toBeVisible()
    // It sits below the theme cards: the screenshot has to show the control itself.
    page.getByTestId('setting-motion').element().scrollIntoView({ block: 'center' })
    await reviewUi('motion setting', { widths: [760, 1400], themes: ['default', 'glass'] })
  })
})
