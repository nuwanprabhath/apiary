import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from '../renderApp'
import { sidebarSession, until } from '../helpers'
import { reviewUi } from './review'

const TYPED = 'You can use this worktree related to #2779. It keeps going long enough to need a second line in the composer at a narrow width.'

describe('UI text carried from the terminal', () => {
  it('composer with text carried from the terminal', async () => {
    const { fake } = await renderApp({ settings: { transcriptChat: true } })
    fake.override('terminalTypedInput', async () => TYPED)
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await userEvent.click(page.getByTestId('resume-button'))
    await until(() => fake.callsTo('resume').length === 1)
    await userEvent.click(page.getByTestId('view-transcript'))
    await expect.element(page.getByTestId('composer-input')).toHaveValue(TYPED)
    await reviewUi('composer with carried text', {
      widths: [620, 1000],
      within: () => document.querySelector('[data-testid="composer"]'),
    })
  })
})
