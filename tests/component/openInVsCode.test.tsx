import { describe, it, expect } from 'vitest'
import { page, userEvent } from '@vitest/browser/context'
import { renderApp } from './renderApp'
import { sidebarSession } from './helpers'

describe('the "Open in VS Code" button', () => {
  it('is absent when VS Code was not found', async () => {
    await renderApp({ vsCode: false })
    await userEvent.hover(sidebarSession('Fix CSV export bug'))
    await expect.element(page.getByTestId('hover-card-open-vscode')).not.toBeInTheDocument()
  })
})
