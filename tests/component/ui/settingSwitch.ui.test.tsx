import { describe, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from '../renderApp'
import { sidebarSession, until } from '../helpers'
import { reviewUi } from './review'

/** The "/" menu's Chat settings row as a switch: on, and off. */
async function openChat(hideToolCallIo: boolean): Promise<void> {
  await renderApp({ settings: { transcriptChat: true, hideToolCallIo } })
  await userEvent.click(sidebarSession('Fix CSV export bug'))
  await until(() => document.querySelector('[data-testid="chat-timeline"]') !== null)
}

const openMenu = async (): Promise<void> => {
  await userEvent.click(page.getByTestId('composer-commands'))
  await until(() => document.querySelector('[data-testid="composer-setting-option"]') !== null)
}
const closeMenu = (): Promise<void> => userEvent.keyboard('{Escape}')

describe('UI: the setting switch', () => {
  it('setting switch on', async () => {
    await openChat(false)
    await reviewUi('setting switch on', { widths: [620, 900], open: openMenu, close: closeMenu })
  })

  it('setting switch off', async () => {
    await openChat(true)
    await reviewUi('setting switch off', { widths: [620, 900], open: openMenu, close: closeMenu })
  })
})
