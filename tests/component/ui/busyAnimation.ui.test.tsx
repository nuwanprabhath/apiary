import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { emptyChatState } from '@shared/domain/chat'
import { asSessionId } from '@shared/domain/ids'
import type { BusyAnimationId, BusyColorId } from '@shared/domain/busyAnimation'
import { renderApp } from '../renderApp'
import { mouse, sidebarSession, until } from '../helpers'
import { reviewUi } from './review'

/** The working animation: the Settings → Themes picker, and each animation on the working line. */
const TITLE = 'Fix CSV export bug'

async function working(busyAnimation: BusyAnimationId, busyAnimationColor: BusyColorId): Promise<void> {
  const { fake } = await renderApp({ settings: { transcriptChat: true, busyAnimation, busyAnimationColor } })
  await userEvent.click(sidebarSession(TITLE))
  await expect.element(page.getByTestId('chat-timeline')).toBeVisible()
  const sessionId = fake.state.sessions.find((s) => s.title === TITLE)!.sessionId
  const next = { ...emptyChatState(asSessionId(sessionId)), status: 'busy' as const, turnStartedAt: Date.now() }
  fake.state.chats.set(sessionId, next)
  fake.emit('chatChanged', { kind: 'full', state: next })
  await expect.element(page.getByTestId('chat-working')).toBeVisible()
  await mouse.move(1, 1)
  await until(() => document.querySelector('.hover-card') === null)
}

const line = (): Element | null => document.querySelector('[data-testid="chat-working"]')

describe('UI working animation', () => {
  it.each([
    ['orbit', 'claude'], ['comet', 'theme'], ['atom', 'aurora'], ['spark', 'mono'],
  ] as const)('the %s animation in %s on the working line', async (animation, color) => {
    await working(animation, color)
    await reviewUi(`working line ${animation} ${color}`, { widths: [1000], within: line })
  })

  it('the picker in Settings → Themes', async () => {
    const { fake } = await renderApp({ settings: { busyAnimation: 'orbit', busyAnimationColor: 'claude' } })
    fake.emit('openSettingsDialog')
    await until(() => document.querySelector('[data-testid="settings-dialog"]') !== null)
    await userEvent.click(page.getByTestId('settings-nav-themes'))
    const picker = (): Element | null => document.querySelector('.busy-settings')
    await until(() => picker() !== null)
    await reviewUi('working animation picker', {
      widths: [1000, 1400],
      within: picker,
      // The colour chips are under the cards; scrolled to, so both are in the shot.
      open: async () => { document.querySelector('.busy-colors')?.scrollIntoView({ block: 'end' }) },
    })
  })
})
