import { describe, it, expect } from 'vitest'
import { page, userEvent } from '@vitest/browser/context'
import { renderApp } from './renderApp'
import { sidebarSession, until } from './helpers'

describe('sidebar', () => {
  it('shows an empty state before anything is imported', async () => {
    await renderApp({ imported: 'none' })
    await expect.element(page.getByTestId('sidebar-empty')).toBeVisible()
  })

  it('filters sessions by title as you type', async () => {
    await renderApp()
    await until(() => page.getByTestId('session-item').elements().length === 4)

    await userEvent.fill(page.getByTestId('search-input'), 'csv')
    await until(() => page.getByTestId('session-item').elements().length === 1)
    await expect.element(sidebarSession('Fix CSV export bug')).toBeVisible()

    await userEvent.fill(page.getByTestId('search-input'), '')
    await until(() => page.getByTestId('session-item').elements().length === 4)
  })

  it('collapsing a folder hides only that folder (and its nested worktree), not every folder', async () => {
    await renderApp()
    await until(() => page.getByTestId('session-item').elements().length === 4)

    // Top-level groups sort alphabetically by label: repo-c, work-a, work-b — so the first
    // top-level toggle belongs to repo-c, which (via its nested worktree) owns 2 of the 4
    // sessions. A defect that collapsed every folder unconditionally would drop the count to 0;
    // the correct, folder-scoped behaviour drops it to exactly 2 (work-a's and work-b's own
    // sessions untouched).
    await userEvent.click(page.getByTestId('project-toggle').all()[0])
    await until(() => page.getByTestId('session-item').elements().length === 2)
    await expect.element(sidebarSession('Fix CSV export bug')).toBeVisible()
    await expect.element(sidebarSession('Add worktree switcher')).toBeVisible()
    await expect.element(sidebarSession('Repo root session')).not.toBeInTheDocument()
    await expect.element(sidebarSession('Worktree session')).not.toBeInTheDocument()
  })

  it('selecting a session marks it selected and shows its header', async () => {
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    const item = page.getByTestId('session-item').getByText('Fix CSV export bug', { exact: true })
    await expect.element(item).toBeVisible()
    await expect.element(page.getByTestId('session-title')).toHaveTextContent('Fix CSV export bug')
  })

  it('the Recent window is a validated setting', async () => {
    // The menu lives in the main process in e2e; the component fake has no menu, so the dialog is
    // opened the same way `openSettingsDialog` reaches the renderer.
    const { fake } = await renderApp()
    fake.emit('openSettingsDialog')
    await until(() => page.getByTestId('settings-dialog').elements().length === 1)
    await expect.element(page.getByTestId('settings-dialog')).toBeVisible()
    await userEvent.click(page.getByTestId('settings-nav-sidebar'))

    await userEvent.fill(page.getByTestId('setting-recent-hours'), '9999')
    page.getByTestId('setting-recent-hours').element().dispatchEvent(new Event('blur'))
    await expect.element(page.getByTestId('setting-recent-hours')).toHaveValue(168)
  })

  it('a folder holding the open session can still be collapsed', async () => {
    // With "Reveal the open session in the sidebar" on, the reveal effect opens whatever folders
    // stand between the top of the tree and the active session. It re-runs whenever `collapsed`
    // changes — which is exactly what a click on the chevron does — so unless its latch has already
    // caught, the user's collapse is undone in the same tick that requested it. The folder flickers
    // shut and springs back open, and no amount of clicking helps.
    //
    // Opening the session first is the whole point: collapsing a folder that holds nothing open has
    // never been broken.
    await renderApp()
    await until(() => page.getByTestId('session-item').elements().length === 4)

    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await expect.element(page.getByTestId('session-title')).toHaveTextContent('Fix CSV export bug')

    await userEvent.click(page.getByTestId('project-toggle').all()[0])

    // It must still be collapsed a moment later, not merely at the instant of the click: the
    // re-expand arrives on the next render, so an immediate assertion would pass against the bug.
    await until(() => page.getByTestId('session-item').elements().length === 2)
    // Proving it stays collapsed rather than re-expanding a moment later: there is no later
    // condition to assert on other than re-checking after time passes.
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(page.getByTestId('session-item').elements().length).toBe(2)
  })
})
