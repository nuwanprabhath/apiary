import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from '../renderApp'
import { sidebarSession } from '../helpers'
import { reviewUi } from './review'

describe('UI: the "/" menu', () => {
  it('open menu with the Actions group', async () => {
    await renderApp({ vsCode: true, settings: { transcriptChat: true } })
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await expect.element(page.getByTestId('composer-commands')).toBeVisible()
    await reviewUi('slash menu with actions', {
      open: async () => {
        if (document.querySelector('[data-testid="composer-command-menu"]') === null) {
          await userEvent.click(page.getByTestId('composer-commands'))
        }
        await expect.element(page.getByTestId('composer-action-option')).toBeVisible()
      },
      close: () => userEvent.keyboard('{Escape}'),
    })
  })
})
