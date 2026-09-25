import { describe, it, expect } from 'vitest'
import { page, userEvent } from '@vitest/browser/context'
import { renderApp } from './renderApp'

describe('the component harness', () => {
  it('renders the app against the fake, with the fixture sessions in the sidebar', async () => {
    const { fake } = await renderApp()
    await expect.element(page.getByText('Fix CSV export bug', { exact: true })).toBeVisible()
    await userEvent.click(page.getByText('Fix CSV export bug', { exact: true }))
    await expect.element(page.getByTestId('session-title')).toHaveTextContent('Fix CSV export bug')
    expect(fake.callsTo('transcript')[0]?.[0]).toBe('11111111-1111-1111-1111-111111111111')
  })

  it('starts each test fresh', async () => {
    await renderApp({ imported: 'none' })
    await expect.element(page.getByTestId('sidebar-empty')).toBeVisible()
  })
})
