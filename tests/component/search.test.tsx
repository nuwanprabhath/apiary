import { describe, it, expect } from 'vitest'
import { page, userEvent } from '@vitest/browser/context'
import { renderApp } from './renderApp'
import { sidebarSession, clickRowAction, until } from './helpers'

describe('search', () => {
  it('search renders a flat list, and clearing it restores the tree with its collapse state', async () => {
    await renderApp()
    // A folder collapsed before searching must still be collapsed after — proof the tree was never
    // torn down and rebuilt underneath the search, only hidden behind the flat list.
    const toggle = page.getByTestId('project-toggle').elements()[0]
    await userEvent.click(toggle)
    await expect.element(toggle).toHaveAttribute('aria-expanded', 'false')

    await userEvent.fill(page.getByTestId('search-input'), 'csv')
    await until(() => page.getByTestId('flat-results').elements().length === 1)
    // No folder chrome at all while a flat list is on screen.
    expect(page.getByTestId('project-toggle').elements()).toHaveLength(0)
    await until(() => page.getByTestId('session-subtitle').elements().length > 0)

    await userEvent.click(page.getByTestId('search-clear'))
    await until(() => page.getByTestId('flat-results').elements().length === 0)
    await expect.element(page.getByTestId('project-toggle').elements()[0]).toHaveAttribute('aria-expanded', 'false')
  })

  it('a pinned session that matches the search is listed once, not in both sections', async () => {
    await renderApp()
    // The tree already leaves pinned sessions out of the folder they live in (SessionTree renders
    // only a folder's unpinned rows); the flat results list did not, so searching for a pinned
    // session's title drew it in Pinned and again in the results below.
    await clickRowAction('Fix CSV export bug', 'pin-session-button')
    await expect.element(page.getByTestId('pinned-section')).toBeVisible()

    await userEvent.fill(page.getByTestId('search-input'), 'csv')
    // The only match is the pinned one, so the results list is there but empty.
    await until(() => page.getByTestId('flat-results').elements().length === 1)
    await until(() => page.getByTestId('pinned-section').getByTestId('session-item').elements().length === 1)
    expect(page.getByTestId('flat-results').getByTestId('session-item').elements()).toHaveLength(0)
    expect(sidebarSession('Fix CSV export bug').elements()).toHaveLength(1)
  })

  it('typing is instant and the box says so while the results catch up', async () => {
    // The contract: the text appears immediately, the results are allowed to take their time, and
    // the box shows that it is still working rather than appearing to have swallowed the input.
    await renderApp()
    const el = document.querySelector<HTMLInputElement>('[data-testid="search-input"]')
    if (el === null) throw new Error('no search input')
    // Called directly off the descriptor: React tracks the native input value setter, so a plain
    // `el.value = ...` assignment would not be seen as a real change.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, 'worktree')
    el.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((resolve) => { requestAnimationFrame(() => { resolve(null) }) })
    // Both read in the same frame as the keystroke: the text is painted, and the results — which
    // have not been told about the query yet — are still catching up.
    expect(el.value).toBe('worktree')
    expect(document.querySelector('[data-testid="search-spinner"]')).not.toBeNull()

    // And it settles: the spinner goes once the results match what was typed.
    await until(() => page.getByTestId('search-spinner').elements().length === 0)
    await expect.element(sidebarSession('Add worktree switcher')).toBeVisible()
  })

  it('a failing content search is reported, not silently treated as no matches', async () => {
    // Unreported, this is close to invisible: the sidebar simply stops finding sessions by what was
    // said in them, which looks exactly like a search that found nothing, and stays that way.
    const { fake } = await renderApp()
    fake.override('searchContent', async () => { throw new Error('index is broken') })

    await userEvent.fill(page.getByTestId('search-input'), 'empty')

    // Scoped to the error toast.
    await until(() => document.querySelector('[data-testid="notification"][data-kind="error"]') !== null)
    const notification = document.querySelector('[data-testid="notification"][data-kind="error"]')!
    expect(notification.textContent).toContain('Searching conversation contents failed')

    // And the sidebar still filters by everything it can do locally, rather than going blank.
    await userEvent.fill(page.getByTestId('search-input'), 'worktree')
    await expect.element(sidebarSession('Add worktree switcher')).toBeVisible()
  })
})
