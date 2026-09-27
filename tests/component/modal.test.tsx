import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { clickRowAction, sessionRow } from './helpers'

/**
 * The shared `ui/Modal.tsx` primitive (UI-25), exercised through `DeleteSessionDialog` — the
 * simplest real dialog built on it, and the one the finding calls out by name for defaulting focus
 * to Cancel. What is being proven here belongs to `Modal` itself, not to session deletion, so this
 * lives apart from `deleteSession.test.tsx`'s behavioural tests.
 */
describe('the Modal primitive', () => {
  it('is named for a screen reader via aria-labelledby, focuses Cancel first, and closes on Escape', async () => {
    await renderApp()
    await clickRowAction('Fix CSV export bug', 'delete-session-button')

    const dialog = document.querySelector<HTMLElement>('[data-testid="delete-session-dialog"]')
    if (dialog === null) throw new Error('no delete-session-dialog')
    expect(dialog.getAttribute('role')).toBe('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    const labelledBy = dialog.getAttribute('aria-labelledby')
    expect(labelledBy).not.toBeNull()
    expect(document.getElementById(labelledBy ?? '')?.textContent).toMatch(/Remove this session/)

    // Destructive confirms default to the safe answer, not the button that does the thing.
    expect(document.activeElement).toBe(page.getByTestId('delete-session-cancel').element())

    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByTestId('delete-session-dialog')).not.toBeInTheDocument()
  })

  it('traps Tab inside the dialog', async () => {
    await renderApp()
    const row = await sessionRow('Fix CSV export bug')
    await userEvent.hover(row)
    const wrap = row.closest<HTMLElement>('.session-row-wrap') ?? row
    const button = wrap.querySelector<HTMLElement>('[data-testid="delete-session-button"]')
    if (button === null) throw new Error('no delete-session-button')
    await userEvent.click(page.elementLocator(button))

    await expect.element(page.getByTestId('delete-session-dialog')).toBeVisible()
    const cancel = page.getByTestId('delete-session-cancel').element()
    const confirm = page.getByTestId('delete-session-confirm').element()
    expect(document.activeElement).toBe(cancel)

    // Shift+Tab from the first (focused) control wraps around to the last one, rather than
    // leaving the dialog for whatever is behind the backdrop.
    await userEvent.tab({ shift: true })
    expect(document.activeElement).toBe(confirm)
    // And Tab from the last wraps back to the first.
    await userEvent.tab()
    expect(document.activeElement).toBe(cancel)
  })
})
