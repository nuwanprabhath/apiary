import { describe, it, expect } from 'vitest'
import { page, userEvent } from '@vitest/browser/context'
import { renderApp } from './renderApp'
import { until } from './helpers'

describe('diagnostics settings', () => {
  it('says what it does and does not record, before you turn it on', async () => {
    const { fake } = await renderApp()
    fake.emit('openSettingsDialog')
    // `fake.emit` runs synchronously, outside any React event handler, so the dialog is not yet in
    // the DOM the instant this call returns — waited for directly rather than through
    // `expect.element`, whose first (failing) poll here trips a pretty-format recursion bug when
    // asked to print a locator that resolved to nothing.
    await until(() => document.querySelector('[data-testid="settings-dialog"]') !== null)
    await userEvent.click(page.getByTestId('settings-nav-diagnostics'))

    const privacy = page.getByTestId('diagnostics-privacy')
    await expect.element(privacy).toHaveTextContent('no prompts')
    await expect.element(privacy).toHaveTextContent('~')
  })
})
