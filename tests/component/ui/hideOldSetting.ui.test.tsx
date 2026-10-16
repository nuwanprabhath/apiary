import { describe, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from '../renderApp'
import { until } from '../helpers'
import { reviewUi, type UiWidth } from './review'

const WIDTHS: UiWidth[] = [620, 1000]

async function openSidebarSettings(): Promise<void> {
  const { fake } = await renderApp()
  fake.emit('openSettingsDialog')
  await until(() => document.querySelector('[data-testid="settings-dialog"]') !== null)
  await userEvent.click(page.getByTestId('settings-nav-sidebar'))
  await until(() => document.querySelector('[data-testid="setting-hide-old-enabled"]') !== null)
}

describe('UI: Settings → Sidebar, hide old sessions', () => {
  it('hide old sessions: unchecked', async () => {
    await openSidebarSettings()
    await reviewUi('hide old unchecked', { widths: WIDTHS })
  })

  it('hide old sessions: checked, with the days field', async () => {
    await openSidebarSettings()
    await userEvent.click(page.getByTestId('setting-hide-old-enabled'))
    await until(() => document.querySelector('[data-testid="setting-hide-old-days"]') !== null)
    await reviewUi('hide old checked', { widths: WIDTHS })
  })
})
