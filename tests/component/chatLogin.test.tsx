import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { asSessionId } from '@shared/domain/ids'
import { renderApp } from './renderApp'
import { sidebarSession, until } from './helpers'

/**
 * `/login` in a chat: Claude Code answers it in stream-json mode with "/login isn't available in
 * this environment", so the message box starts a terminal under the session's account, types
 * `/login` into it and opens it as a tab, where the sign-in link opens in this machine's browser.
 */
const TITLE = 'Fix CSV export bug'

describe('/login in a chat', () => {
  it('opens a login terminal under the session\'s account, types /login there, and sends nothing to Claude', async () => {
    const { fake } = await renderApp({ settings: { transcriptChat: true } })
    await userEvent.click(sidebarSession(TITLE))
    await expect.element(page.getByTestId('chat-timeline')).toBeVisible()
    const sessionId = fake.state.sessions.find((s) => s.title === TITLE)!.sessionId
    const account = await window.apiary.sessionAccountGet(asSessionId(sessionId))

    await userEvent.fill(page.getByTestId('composer-input'), '/login')
    await userEvent.keyboard('{Enter}')

    await until(() => fake.callsTo('sendPrompt').length > 0)
    expect(fake.callsTo('accountsLogin')).toEqual([[account]])
    const [ptyId, typed] = fake.callsTo('sendPrompt')[0]!
    expect(typed).toBe('/login')
    await expect.element(page.getByTestId('terminal-session')).toBeVisible()
    expect(fake.callsTo('ptySnapshot').some((args) => args[0] === ptyId)).toBe(true)
    expect(fake.callsTo('chatSend')).toEqual([])
  })

  it('is offered in the "/" menu as one of Apiary\'s own commands', async () => {
    await renderApp({ settings: { transcriptChat: true } })
    await userEvent.click(sidebarSession(TITLE))
    await expect.element(page.getByTestId('chat-timeline')).toBeVisible()
    await userEvent.fill(page.getByTestId('composer-input'), '/log')
    await expect.element(page.getByText('Sign in again, in a terminal under this session\'s account')).toBeVisible()
  })
})
