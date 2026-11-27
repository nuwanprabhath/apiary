import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import type { TerminalNotice } from '@shared/terminalNotice'
import { renderApp } from './renderApp'
import { sidebarSession, stays } from './helpers'
import type { FakeApiary } from './fakeApiary'

const TITLE = 'Fix CSV export bug'
const NOTICE: TerminalNotice = {
  tag: 'Heads up',
  text: 'The new build checkbox will only appear for branches that already contain the change.',
  choices: [{ key: '1', label: 'Learn more' }, { key: '2', label: 'Knew this already' }, { key: '0', label: 'Dismiss' }],
}

/** The session's chat, with its claude running in its terminal and main reading `notice` off that screen. */
async function openRunning(): Promise<{ fake: FakeApiary; show: (notice: TerminalNotice | null) => void }> {
  const { fake } = await renderApp({ settings: { transcriptChat: true } })
  await userEvent.click(sidebarSession(TITLE))
  const sessionId = fake.state.sessions.find((s) => s.title === TITLE)!.sessionId
  await userEvent.click(page.getByTestId('resume-button'))
  await userEvent.click(page.getByTestId('view-transcript'))
  let notice: TerminalNotice | null = null
  fake.override('activeTabs', async () => fake.state.tabs.map((t) => (t.key === sessionId && notice !== null ? { ...t, notice } : t)))
  return { fake, show: (n) => { notice = n; fake.emit('activeTabsChanged') } }
}

describe('a note Claude Code shows only in the terminal', () => {
  it('shows in the chat over the message box, with the answers the terminal takes', async () => {
    const { show } = await openRunning()
    await stays(() => document.querySelector('[data-testid="chat-terminal-notice"]') === null, 200, 'no note before one shows')
    show(NOTICE)
    await expect.element(page.getByTestId('chat-terminal-notice')).toBeVisible()
    expect(page.getByTestId('chat-terminal-notice').element().textContent).toContain('Heads up · The new build checkbox')
    expect(page.getByTestId('chat-terminal-notice-choices').element().textContent).toBe('1: Learn more   2: Knew this already   0: Dismiss')
    show(null)
    await expect.poll(() => document.querySelector('[data-testid="chat-terminal-notice"]')).toBeNull()
  })

  it('"Answer in the terminal" shows the terminal', async () => {
    const { show } = await openRunning()
    show(NOTICE)
    await userEvent.click(page.getByTestId('chat-terminal-notice-open'))
    await expect.element(page.getByTestId('transcript')).not.toBeVisible()
  })
})
