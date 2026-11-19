import { describe, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { renderApp } from '../renderApp'
import { until } from '../helpers'
import { message, withRegent } from '../residentFixtures'
import { reviewUi, type UiWidth } from './review'

const WIDTHS: UiWidth[] = [620, 1000]

describe('UI: Regent popup with Slack', () => {
  it('resident popup with messages from Slack and notes', async () => {
    await renderApp({}, (f) => {
      withRegent(f, {
        history: [
          { ...message('user', 'Open the session where we fixed the CSV export'), via: 'slack' },
          message('assistant', 'Opened **Fix CSV export bug** in a new tab.'),
          { ...message('user', "Session 'Fix CSV export bug' finished a turn"), note: true },
          { ...message('user', 'A long second question from Slack that wraps onto several lines in a narrow popup so the label and bubble are checked'), via: 'slack' },
        ],
      })
    })
    await until(() => document.querySelector('[data-testid="resident-badge-regent"]') !== null)
    await userEvent.click(document.querySelector('[data-testid="resident-badge-regent"]')!)
    await until(() => document.querySelector('[data-testid="resident-via"]') !== null)
    await reviewUi('resident popup slack', { widths: WIDTHS })
  })
})
