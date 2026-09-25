import { describe, it, expect } from 'vitest'
import { page, userEvent } from '@vitest/browser/context'
import { renderApp } from './renderApp'
import { sidebarSession, until } from './helpers'

/** A project-group `<li>` whose OWN toggle carries this label — `closest()` from the toggle
 *  itself, so a nested worktree group further down the same subtree is never picked up instead. */
function groupLabelled(label: string): HTMLElement {
  const toggle = [...document.querySelectorAll<HTMLElement>('[data-testid="project-toggle"]')]
    .find((t) => t.querySelector('.project-label')?.textContent === label)
  const group = toggle?.closest<HTMLElement>('[data-testid="project-group"]')
  if (group === null || group === undefined) throw new Error(`no project group for "${label}"`)
  return group
}

describe('starting a new session from a folder', () => {
  it('clicking "+" does not toggle the folder\'s expand/collapse state', async () => {
    await renderApp()
    const workA = groupLabelled('work-a')
    const toggle = workA.querySelector<HTMLElement>('[data-testid="project-toggle"]')
    if (toggle === null) throw new Error('no toggle on work-a')

    // Starts expanded (default): its session is visible.
    await expect.element(page.elementLocator(toggle)).toHaveAttribute('aria-expanded', 'true')
    await expect.element(sidebarSession('Fix CSV export bug')).toBeVisible()

    const newSessionButton = workA.querySelector<HTMLElement>('[data-testid="new-session-button"]')
    if (newSessionButton === null) throw new Error('no new-session-button on work-a')
    await userEvent.click(newSessionButton)
    await expect.element(page.getByTestId('terminal-session')).toBeVisible()

    // Still expanded, and the pre-existing session row is still there — the click did not
    // collapse it (nor did it toggle some unrelated group).
    await expect.element(page.elementLocator(toggle)).toHaveAttribute('aria-expanded', 'true')
    await expect.element(sidebarSession('Fix CSV export bug')).toBeVisible()

    // Now collapse it by hand, then click "+" again — it must stay collapsed too, proving the
    // handler never touches expand/collapse state in either direction.
    await userEvent.click(toggle)
    await expect.element(page.elementLocator(toggle)).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(newSessionButton)
    await until(() => toggle.getAttribute('aria-expanded') === 'false')
  })
})
