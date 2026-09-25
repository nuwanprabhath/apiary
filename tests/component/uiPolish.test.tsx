import { describe, it, expect } from 'vitest'
import { page, userEvent } from '@vitest/browser/context'
import { renderApp } from './renderApp'
import { until } from './helpers'

describe('ui polish', () => {
  it('the search box clears from its own button', async () => {
    await renderApp()
    const search = page.getByTestId('search-input')
    // The button only exists while there is something to clear — an always-present X over an
    // empty field is just noise.
    expect(page.getByTestId('search-clear').elements()).toHaveLength(0)

    await userEvent.fill(search, 'worktree')
    // Filtering is debounced, so the list is briefly still the unfiltered four on the way to
    // being narrowed — wait for the narrowed count rather than merely "something is there".
    await until(() => {
      const n = page.getByTestId('session-item').elements().length
      return n > 0 && n < 4
    })

    await userEvent.click(page.getByTestId('search-clear'))
    await expect.element(search).toHaveValue('')
    expect(page.getByTestId('search-clear').elements()).toHaveLength(0)
    await until(() => page.getByTestId('session-item').elements().length === 4)
  })

  it('the refresh button keeps a stable width while it spins', async () => {
    // Regression: the button used to swap its whole "Refresh" label out for a bare spinner glyph
    // while a refresh was in flight, which visibly shrank the button — jarring, and easy to
    // misread as the control itself vanishing. The label now stays put; only the icon spins.
    await renderApp()
    const button = document.querySelector<HTMLElement>('[data-testid="sidebar-refresh"]')!
    const before = button.getBoundingClientRect()

    await userEvent.click(page.getByTestId('sidebar-refresh'))
    await expect.element(button).toHaveTextContent('Refresh')
    const after = button.getBoundingClientRect()
    expect(Math.abs(before.width - after.width)).toBeLessThan(2)
  })

  it('the buttons in a dialog footer are the same size as each other', async () => {
    // Regression: every group of buttons in the app used to carry its own padding, so a Cancel
    // and a Save sitting side by side were visibly different heights. They now resolve one set of
    // tokens; this asserts the outcome rather than the mechanism.
    const { fake } = await renderApp()
    fake.emit('openSettingsDialog')
    await until(() => document.querySelector('[data-testid="settings-dialog"]') !== null)

    const height = (testId: string): number =>
      Math.round(document.querySelector(`[data-testid="${testId}"]`)!.getBoundingClientRect().height)
    expect(height('settings-save')).toBe(height('settings-cancel'))
  })

  it('folders collapse, so a long folder is not in the way of the next one', async () => {
    // A fresh, unimported library: an all-imported folder's checkbox is deliberately disabled.
    const { fake } = await renderApp({ imported: 'none' })
    fake.emit('openImportDialog')
    await until(() => document.querySelector('[data-testid="import-dialog"]') !== null)

    const rowsBefore = page.getByTestId('import-session-checkbox').elements().length
    expect(rowsBefore).toBeGreaterThan(0)

    const firstGroup = document.querySelector<HTMLElement>('[data-testid="import-group"]')!
    const initialInGroup = firstGroup.querySelectorAll('[data-testid="import-session-checkbox"]').length
    await userEvent.click(firstGroup.querySelector<HTMLElement>('[data-testid="import-group-toggle"]')!)
    await until(() => firstGroup.querySelectorAll('[data-testid="import-session-checkbox"]').length === 0)
    // Only that folder folded away; the others are untouched.
    expect(page.getByTestId('import-session-checkbox').elements()).toHaveLength(rowsBefore - initialInGroup)

    // Collapsed or not, the folder checkbox still selects everything inside it — which is the
    // whole point: tick the folder, fold it, move on to the next one without scrolling past it.
    const groupCheckbox = firstGroup.querySelector<HTMLElement>('[data-testid="import-group-checkbox"]')!
    await userEvent.click(groupCheckbox)
    await expect.element(groupCheckbox).toBeChecked()

    await userEvent.click(firstGroup.querySelector<HTMLElement>('[data-testid="import-group-toggle"]')!)
    await until(() => firstGroup.querySelectorAll('[data-testid="import-session-checkbox"]').length === initialInGroup)
  })
})
