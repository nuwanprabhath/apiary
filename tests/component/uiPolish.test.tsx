import { describe, it, expect, afterEach } from 'vitest'
import { page, userEvent, commands } from 'vitest/browser'
import { renderApp } from './renderApp'
import { sidebarSession, until } from './helpers'
import { expectConsoleError } from './setup'

describe('ui polish', () => {
  // Every test that emulates prefers-reduced-motion resets it, so a later test in this file (or
  // another one sharing the same page) isn't left running under an emulation it never asked for.
  afterEach(async () => { await commands.emulateMedia('no-preference') })

  it('the document declares its language, for assistive tech (UI-29)', async () => {
    await renderApp()
    expect(document.documentElement.lang).toBe('en')
  })

  it('reduced motion stops the infinite spinners and the running dot\'s animation (UI-29)', async () => {
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await until(() => document.querySelector('[data-testid="active-section"]') !== null)
    await userEvent.hover(page.getByTestId('active-header'))
    await until(() => document.querySelector('[data-testid="activity-legend"]') !== null)
    const runningDot = document.querySelector<HTMLElement>('.activity-legend [data-status="running"]')
    if (runningDot === null) throw new Error('no running dot in the legend')

    // Motion on by default: the row animates.
    expect(getComputedStyle(runningDot).animationName).not.toBe('none')

    await commands.emulateMedia('reduce')
    await until(() => getComputedStyle(runningDot).animationName === 'none')
    // Colour is no longer the only thing telling `running` apart from `idle` once the motion that
    // used to do that job is gone (WCAG 1.4.1) — it keeps a shape cue too.
    expect(getComputedStyle(runningDot).boxShadow).not.toBe('none')
  })

  it('reduced motion stops the one-shot notification entrance animation too (UI-29)', async () => {
    await commands.emulateMedia('reduce')
    await renderApp()
    expectConsoleError(/NOTIFICATION_UNDER_REDUCED_MOTION/)
    void Promise.reject(new Error('NOTIFICATION_UNDER_REDUCED_MOTION'))
    await until(() => document.querySelector('[data-testid="notification"]') !== null)
    const notification = document.querySelector<HTMLElement>('[data-testid="notification"]')!
    expect(getComputedStyle(notification).animationName).toBe('none')
  })

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
    await expect.element(button).toMatchTextContent('Refresh')
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
