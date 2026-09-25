import { describe, it, expect } from 'vitest'
import { page, userEvent } from '@vitest/browser/context'
import { renderApp } from './renderApp'
import type { FakeApiary } from './fakeApiary'
import { until } from './helpers'

/**
 * Opens Settings the way the app really does: a main-process event, not a prop. `fake.emit` runs
 * synchronously, outside any React event handler, so the dialog is not yet in the DOM the instant
 * this call returns — waited for directly rather than through `expect.element`, whose first
 * (failing) poll here trips a pretty-format recursion bug when asked to print a locator that
 * resolved to nothing.
 */
async function openSettings(fake: FakeApiary): Promise<void> {
  fake.emit('openSettingsDialog')
  await until(() => document.querySelector('[data-testid="settings-dialog"]') !== null)
}

describe('settings', () => {
  it('settings are organised into sections, and the section you pick is the one you see', async () => {
    const { fake } = await renderApp()
    await openSettings(fake)
    // Sessions first, since that is what the app is for.
    await expect.element(page.getByTestId('settings-pane')).toHaveTextContent('Automatically import all sessions')
    expect(page.getByTestId('claude-bin-input').elements()).toHaveLength(0)

    await userEvent.click(page.getByTestId('settings-nav-general'))
    await expect.element(page.getByTestId('claude-bin-input')).toBeVisible()
    await expect.element(page.getByTestId('settings-pane')).not.toHaveTextContent('Automatically import all sessions')
  })

  it('Escape closes the settings dialog', async () => {
    const { fake } = await renderApp()
    await openSettings(fake)
    await userEvent.keyboard('{Escape}')
    await until(() => document.querySelector('[data-testid="settings-dialog"]') === null)
    expect(document.querySelector('[data-testid="settings-dialog"]')).toBeNull()
  })

  it('with auto-import on, the import dialog says so instead of offering an empty choice', async () => {
    const { fake } = await renderApp({ imported: 'none' })
    await openSettings(fake)
    await userEvent.click(page.getByTestId('setting-auto-import-all'))
    await userEvent.click(page.getByTestId('settings-save'))
    await until(() => document.querySelector('[data-testid="settings-dialog"]') === null)

    fake.emit('openImportDialog')
    await until(() => document.querySelector('[data-testid="import-dialog"]') !== null)
    await expect.element(page.getByTestId('import-auto-notice')).toBeVisible()
    await expect.element(page.getByTestId('import-auto-notice')).toHaveTextContent(/Settings/i)
  })

  it('the periodic check is off unless it is switched on, and its interval only then appears', async () => {
    const { fake } = await renderApp()
    await openSettings(fake)
    // Off by default: a scan shells out to git once per project, so it is not free.
    await expect.element(page.getByTestId('setting-auto-import-interval-enabled')).not.toBeChecked()
    expect(page.getByTestId('setting-auto-import-interval').elements()).toHaveLength(0)

    await userEvent.click(page.getByTestId('setting-auto-import-interval-enabled'))
    await expect.element(page.getByTestId('setting-auto-import-interval')).toBeVisible()
  })

  it('the prompt-shortening setting shows what it will actually do', async () => {
    // "Keep the last N folders" is a rule whose effect on a real path is not obvious — and the
    // default of two shortened a worktree path so little that the setting looked broken. The
    // example is the fix: the difference between one folder and two is visible rather than argued.
    const { fake } = await renderApp()
    await openSettings(fake)
    await userEvent.click(page.getByTestId('settings-nav-terminal'))
    // Shortening only matters with the path shown at all: the minimal prompt (on by default)
    // removes it, and disables this control while it does.
    await expect.element(page.getByTestId('setting-terminal-shorten-path')).toBeDisabled()
    // Shortening starts checked already (the fake's default settings, like the app's own), so
    // unchecking the minimal prompt alone is enough to reveal it — no need to also click it.
    await userEvent.click(page.getByTestId('setting-terminal-minimal-prompt'))
    await expect.element(page.getByTestId('setting-terminal-shorten-path')).toBeChecked()
    await until(() => document.querySelector('[data-testid="setting-terminal-path-segments"]') !== null)

    const preview = page.getByTestId('terminal-path-preview')
    await userEvent.fill(page.getByTestId('setting-terminal-path-segments'), '1')
    await expect.element(preview).toHaveTextContent('~/.../pipeline-issues')

    await userEvent.fill(page.getByTestId('setting-terminal-path-segments'), '2')
    await expect.element(preview).toHaveTextContent('~/.../paratoo-fdcp.worktrees/pipeline-issues')
  })
})
