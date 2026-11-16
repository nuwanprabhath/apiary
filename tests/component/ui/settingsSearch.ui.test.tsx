import { describe, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from '../renderApp'
import { until } from '../helpers'
import { reviewUi, type UiWidth } from './review'

const WIDTHS: UiWidth[] = [620, 1000]

async function openSettings(): Promise<void> {
  const { fake } = await renderApp()
  fake.emit('openSettingsDialog')
  await until(() => document.querySelector('[data-testid="settings-pane"] .empty') === null
    && document.querySelector('[data-testid="settings-dialog"]') !== null)
}

describe('UI: Settings search', () => {
  it('empty: the field above the sections', async () => {
    await openSettings()
    await reviewUi('settings search empty', { widths: WIDTHS })
  })

  it('typing: matches grouped under their sections, words marked', async () => {
    await openSettings()
    await userEvent.fill(page.getByTestId('settings-search'), 'session')
    await until(() => document.querySelector('[data-testid="settings-results"]') !== null)
    await reviewUi('settings search results', { widths: WIDTHS })
  })

  it('no matches', async () => {
    await openSettings()
    await userEvent.fill(page.getByTestId('settings-search'), 'zzzxq')
    await until(() => document.querySelector('[data-testid="settings-no-results"]') !== null)
    await reviewUi('settings search none', { widths: WIDTHS })
  })

  it('a result opened: the setting marked in its section', async () => {
    await openSettings()
    await userEvent.fill(page.getByTestId('settings-search'), 'proofing')
    await userEvent.keyboard('{Enter}')
    await until(() => document.querySelector('[data-found="true"]') !== null)
    await reviewUi('settings search opened', { widths: WIDTHS })
  })
})
