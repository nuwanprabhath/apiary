import { describe, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from '../renderApp'
import { openBySearch, sidebarSession, until } from '../helpers'
import { FIXTURE_SESSIONS } from '../fakeApiary'
import { reviewUi } from './review'

/** The Chat | Terminal toggle in the tab bar: each state it has, in a wide pane and a narrow one. */
const TITLE = 'Fix CSV export bug'

async function openSession(cwdExists = true): Promise<void> {
  await renderApp(cwdExists ? undefined : {
    sessions: FIXTURE_SESSIONS.map((s) => (s.title === TITLE ? { ...s, cwdExists: false } : s)),
  })
  if (cwdExists) await userEvent.click(sidebarSession(TITLE))
  else await openBySearch(TITLE)
  await until(() => document.querySelector('[data-testid="view-toggle"]') !== null)
}

describe('UI view toggle', () => {
  it('chat in front, no terminal', async () => {
    await openSession()
    await reviewUi('view toggle chat', { widths: [900, 1400] })
  })

  it('terminal in front with its live dot', async () => {
    await openSession()
    await userEvent.click(page.getByTestId('resume-button'))
    await until(() => document.querySelector('[data-testid="session-live-dot"]') !== null)
    await reviewUi('view toggle terminal', { widths: [900, 1400] })
  })

  it('folder missing, Terminal disabled', async () => {
    await openSession(false)
    await reviewUi('view toggle folder missing', { widths: [900, 1400] })
  })

  it('narrow pane, four-pane width', async () => {
    await openSession()
    await reviewUi('view toggle narrow', { widths: [620, 760] })
  })
})
