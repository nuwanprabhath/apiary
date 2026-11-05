import { describe, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { renderApp } from '../renderApp'
import { until } from '../helpers'
import { reviewUi } from './review'

/** work-a's "+" in the sidebar (a folder that is not a repository, so it starts a session at once). */
function plusOfWorkA(): HTMLElement {
  const toggle = [...document.querySelectorAll<HTMLElement>('[data-testid="project-toggle"]')]
    .find((t) => t.querySelector('.project-label')?.textContent === 'work-a')
  const plus = toggle?.closest('[data-testid="project-group"]')?.querySelector<HTMLElement>('[data-testid="new-session-button"]')
  if (plus === null || plus === undefined) throw new Error('no "+" on work-a')
  return plus
}

describe('UI: a new session that opens in the chat', () => {
  it('the first-message box of a session started with "+"', async () => {
    await renderApp({ settings: { transcriptChat: true, newSessionsInChat: true } })
    await until(() => document.querySelectorAll('[data-testid="project-toggle"]').length > 0)
    await userEvent.click(plusOfWorkA())
    await until(() => document.querySelector('[data-testid="pending-chat"]') !== null)
    await reviewUi('pending chat first message')
  })
})
