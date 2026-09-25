import { describe, it, expect } from 'vitest'
import { page, userEvent } from '@vitest/browser/context'
import { renderApp } from './renderApp'
import { sidebarSession, sessionRow, clickRowAction } from './helpers'

describe('deleting a session', () => {
  it('cancelling the delete confirmation leaves the session untouched', async () => {
    await renderApp()
    await clickRowAction('Fix CSV export bug', 'delete-session-button')
    await userEvent.click(page.getByTestId('delete-session-cancel'))

    await expect.element(page.getByTestId('delete-session-dialog')).not.toBeInTheDocument()
    await expect.element(sidebarSession('Fix CSV export bug')).toBeVisible()
  })

  it('deleting the currently-selected session clears the selection', async () => {
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await expect.element(page.getByTestId('session-title')).toHaveTextContent('Fix CSV export bug')

    await clickRowAction('Fix CSV export bug', 'delete-session-button')
    await userEvent.click(page.getByTestId('delete-session-confirm'))

    await expect.element(page.getByTestId('content-empty')).toBeVisible()
  })

  it('the delete button does not select the session it belongs to', async () => {
    await renderApp()
    const row = await sessionRow('Fix CSV export bug')
    await userEvent.hover(row)
    await clickRowAction('Fix CSV export bug', 'delete-session-button')
    // The confirmation dialog opened (proving the click landed), but the session behind it must
    // not have also been selected as a side effect of the click bubbling.
    await expect.element(page.getByTestId('delete-session-dialog')).toBeVisible()
    await userEvent.click(page.getByTestId('delete-session-cancel'))
    await expect.element(page.getByTestId('content-empty')).toBeVisible()
  })
})
