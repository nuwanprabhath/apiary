import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { until } from './helpers'

/** Clicks work-a's "+" in the sidebar. */
async function newSessionInWorkA(): Promise<void> {
  const toggle = [...document.querySelectorAll<HTMLElement>('[data-testid="project-toggle"]')]
    .find((t) => t.querySelector('.project-label')?.textContent === 'work-a')
  const button = toggle?.closest('[data-testid="project-group"]')?.querySelector<HTMLElement>('[data-testid="new-session-button"]')
  if (button === null || button === undefined) throw new Error('no new-session-button on work-a')
  await userEvent.click(button)
}

describe('"Open new sessions in the chat"', () => {
  it('opens a session started with "+" on a first-message box, whose message goes to the new terminal', async () => {
    const { fake } = await renderApp({ settings: { transcriptChat: true, newSessionsInChat: true } })
    await newSessionInWorkA()
    await expect.element(page.getByTestId('pending-chat')).toBeVisible()
    await expect.element(page.getByTestId('pending-chat-input')).toHaveFocus()
    expect(page.getByTestId('terminal-session').query()).toBeNull()

    await userEvent.type(page.getByTestId('pending-chat-input'), 'Hello there{Enter}')
    await until(() => fake.callsTo('sendPrompt').length === 1)
    const [ptyId, text] = fake.callsTo('sendPrompt')[0] as [string, string]
    expect(ptyId).toMatch(/^new:/)
    expect(text).toBe('Hello there')
    await expect.poll(() => document.querySelector('[data-testid="pending-chat"]')?.textContent).toContain('Sent')

    await userEvent.click(page.getByTestId('pending-chat-terminal'))
    await expect.element(page.getByTestId('terminal-session')).toBeVisible()
    await expect.element(page.getByTestId('pending-chat')).not.toBeInTheDocument()
  })

  it('opens on the terminal, as before, without "Run sessions as a chat"', async () => {
    await renderApp({ settings: { transcriptChat: false, newSessionsInChat: true } })
    await newSessionInWorkA()
    await expect.element(page.getByTestId('terminal-session')).toBeVisible()
    expect(page.getByTestId('pending-chat').query()).toBeNull()
  })
})
