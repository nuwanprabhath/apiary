import { describe, it, expect } from 'vitest'
import { page, userEvent } from '@vitest/browser/context'
import { renderApp } from './renderApp'
import { until } from './helpers'
import { FIXTURE_PROJECTS, FIXTURE_SESSIONS } from './fakeApiary'

/** A nested folder row — a worktree under its repository — addressed by its own label. */
function worktree(label: string): HTMLElement {
  const el = [...document.querySelectorAll<HTMLElement>('div.project-row-wrap[data-depth="1"]')]
    .find((w) => w.querySelector('.project-label')?.textContent === label)
  if (el === undefined) throw new Error(`no worktree row for "${label}"`)
  return el
}

function worktreeOrder(): string[] {
  return [...document.querySelectorAll<HTMLElement>('div.project-row-wrap[data-depth="1"] .project-label')]
    .map((el) => el.textContent ?? '')
}

/** A depth-0 folder row, by its own label. */
function repoRow(label: string): HTMLElement {
  const toggle = [...document.querySelectorAll<HTMLElement>('div.project-row-wrap[data-depth="0"] [data-testid="project-toggle"]')]
    .find((t) => t.querySelector('.project-label')?.textContent === label)
  const wrap = toggle?.closest<HTMLElement>('.project-row-wrap')
  if (wrap === null || wrap === undefined) throw new Error(`no folder row for "${label}"`)
  return wrap
}

describe('reordering nested worktrees', () => {
  // The reported case: the repository was filed into a group. A group is a drop target over its
  // whole area, so a drop that landed on a worktree row inside it also reached the group — and the
  // group's own handler wrote back a copy of the arrangement that predated the reorder, silently
  // undoing it.
  it('a worktree inside a grouped repository can still be reordered', async () => {
    await renderApp({
      projects: [
        ...FIXTURE_PROJECTS,
        { path: '/fixture/repo-c-wt2', label: 'repo-c-wt2', branch: 'feature/wt2', isWorktree: true, parent: '/fixture/repo-c' },
      ],
      sessions: [
        ...FIXTURE_SESSIONS,
        { sessionId: '55555555-5555-5555-5555-555555555555', title: 'Second worktree session', projectPath: '/fixture/repo-c-wt2', gitBranch: 'feature/wt2' },
      ],
    })

    await until(() => worktreeOrder().length === 2)
    expect(worktreeOrder()).toEqual(['repo-c-wt', 'repo-c-wt2'])

    await userEvent.click(page.elementLocator(repoRow('repo-c')), { button: 'right' })
    await userEvent.click(page.getByTestId('context-menu-new-group'))
    await userEvent.keyboard('{Enter}')
    await expect.element(page.getByTestId('folder-group')).toBeVisible()
    expect(page.getByTestId('folder-group').elements()).toHaveLength(1)

    await userEvent.dragAndDrop(page.elementLocator(worktree('repo-c-wt2')), page.elementLocator(worktree('repo-c-wt')))
    await until(() => worktreeOrder().join(',') === 'repo-c-wt2,repo-c-wt')
  })
})
