import { describe, it, expect } from 'vitest'
import { page, userEvent } from '@vitest/browser/context'
import { renderApp } from './renderApp'
import { sidebarSession, until } from './helpers'
import { FIXTURE_PROJECTS, FIXTURE_SESSIONS } from './fakeApiary'

/**
 * What a folder row offers beyond opening and closing: where it is on disk, folding away
 * everything beneath it, and getting the whole sidebar out of the way.
 */

/** A top-level (or nested) folder row, addressed by the label on its own toggle — an element, not
 *  a locator, since nothing here renames a folder mid-test. */
function folder(label: string): HTMLElement {
  const row = [...document.querySelectorAll<HTMLElement>('.project-row-wrap')]
    .find((r) => r.querySelector('.project-label')?.textContent === label)
  if (row === undefined) throw new Error(`no folder row for "${label}"`)
  return row
}

/** A second worktree of repo-c, so the nested level is a list of two. */
async function withSecondWorktree(): Promise<void> {
  await renderApp({
    projects: [...FIXTURE_PROJECTS, {
      path: '/fixture/repo-c-wt2', label: 'repo-c-wt2', branch: 'feature/wt2', isWorktree: true, parent: '/fixture/repo-c',
    }],
    sessions: [...FIXTURE_SESSIONS, {
      sessionId: '66666666-6666-6666-6666-666666666666',
      title: 'Second worktree session',
      projectPath: '/fixture/repo-c-wt2',
      gitBranch: 'feature/wt2',
    }],
  })
}

describe('sidebarFolders', () => {
  it('collapse-all folds every worktree in a repository and leaves the repository open', async () => {
    await withSecondWorktree()
    const repo = folder('repo-c')
    const worktrees = () => [...document.querySelectorAll<HTMLElement>('.project-row-wrap[data-depth="1"]')]
    await until(() => worktrees().length === 2)
    const openWorktrees = () => worktrees()
      .filter((el) => el.querySelector('[data-testid="project-toggle"]')?.getAttribute('aria-expanded') === 'true')
    await until(() => openWorktrees().length === 2)

    await userEvent.hover(repo)
    const button = repo.querySelector('[data-testid="collapse-all-button"]') as HTMLElement
    await userEvent.click(button)

    await until(() => openWorktrees().length === 0)
    // Still listed — folded, not hidden — under a repository that is still open.
    expect(worktrees()).toHaveLength(2)
    expect(repo.querySelector('[data-testid="project-toggle"]')?.getAttribute('aria-expanded')).toBe('true')
    await expect.element(sidebarSession('Worktree session')).not.toBeInTheDocument()
  })

  it('a folder with nothing beneath it has no collapse-all button', async () => {
    await renderApp()
    expect(folder('work-a').querySelector('[data-testid="collapse-all-button"]')).toBeNull()
  })

  it('the sidebar hides to a rail and comes back, keeping what was typed into it', async () => {
    await renderApp()
    await userEvent.fill(page.getByTestId('search-input'), 'CSV')
    await userEvent.click(page.getByTestId('sidebar-hide'))
    await expect.element(page.getByTestId('sidebar')).not.toBeVisible()
    await expect.element(page.getByTestId('sidebar-resizer')).not.toBeInTheDocument()
    const content = page.getByTestId('content').element().getBoundingClientRect()
    // The sessions take the width: only the rail is left beside them.
    expect(content.x).toBeLessThan(60)

    await userEvent.click(page.getByTestId('sidebar-show'))
    await expect.element(page.getByTestId('sidebar')).toBeVisible()
    await expect.element(page.getByTestId('sidebar-rail')).not.toBeInTheDocument()
    await expect.element(page.getByTestId('search-input')).toHaveValue('CSV')
  })

  it('a session\'s card offers no pull: its branch may be one it was recorded on, not today\'s checkout', async () => {
    await renderApp()
    await userEvent.hover(sidebarSession('Worktree session'))
    await until(() => page.getByTestId('session-hover-card').elements().length === 1)
    expect(page.getByTestId('hover-card-pull-branch').elements()).toHaveLength(0)
  })
})
