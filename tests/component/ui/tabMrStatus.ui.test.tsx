import { describe, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from '../renderApp'
import { until } from '../helpers'
import { reviewUi } from './review'

describe('tab MR status', () => {
  it('tab title with MR status', async () => {
    await renderApp(
      { sessions: [{ sessionId: '6f1c2a40-1b2c-4d3e-8f90-0a1b2c3d4e5f', title: '!1713 #2779 ResizeObserver loop posthog', projectPath: '/fixture/repo-c' }] },
      (fake) => { fake.override('gitlabMrRefStatus', async () => ({ 1713: 'merged' })) },
    )
    await userEvent.click(page.getByTestId('sidebar').getByText('ResizeObserver loop posthog', { exact: false }).last())
    await until(() => document.querySelector('[data-testid="session-tab-label"] .mr-ref') !== null)
    await reviewUi('tab title with MR status', { within: () => document.querySelector('[data-testid="session-tab"]')?.closest('[role="tablist"]')?.parentElement ?? null })
  })
})
