import { describe, it, expect } from 'vitest'
import { page, userEvent } from '@vitest/browser/context'
import { renderApp } from './renderApp'
import { sidebarSession } from './helpers'

/** A project's folder row in the tree, by its own label. */
function folderRow(label: string): HTMLElement {
  const toggle = [...document.querySelectorAll<HTMLElement>('[data-testid="project-toggle"]')]
    .find((t) => t.querySelector('.project-label')?.textContent === label)
  const wrap = toggle?.closest<HTMLElement>('.project-row-wrap')
  if (wrap === null || wrap === undefined) throw new Error(`no project row for "${label}"`)
  return wrap
}

describe('moving a session by drag', () => {
  it('a live session refuses to be dropped', async () => {
    // `moveSession` is refused outright while the session is live, the same rule
    // `AppService.moveSession` enforces in the real app (a running pty cannot be asked to change
    // the directory a whole process tree is rooted in) — the fake models the refusal by override,
    // since the fake's own `moveSession` has no liveness of its own to check.
    const { fake } = await renderApp()
    fake.override('moveSession', async () => {
      throw new Error('This session is still running — stop it before moving it to another worktree.')
    })

    await userEvent.dragAndDrop(sidebarSession('Fix CSV export bug'), page.elementLocator(folderRow('repo-c-wt')))
    await expect.element(page.getByTestId('move-session-dialog')).toBeVisible()
    await userEvent.click(page.getByTestId('move-session-confirm'))
    await expect.element(page.getByText(/still running/i)).toBeVisible()
  })
})
