import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { stays, until } from './helpers'
import type { GitRefEntry } from '@shared/types'

/**
 * A sidebar folder's "Change branch…": a worktree's branch changes without a session open in it,
 * and a branch another worktree has can be taken by moving that worktree in the same step.
 */
function folderRow(label: string): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>('.project-row-wrap')]
    .find((r) => r.querySelector('.project-label')?.textContent === label)
}

async function rightClick(el: Element): Promise<void> {
  const { x, y, width, height } = el.getBoundingClientRect()
  el.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, clientX: x + width / 2, clientY: y + height / 2,
  }))
}

const ref = (name: string): GitRefEntry => ({ name, relativeDate: '2 days ago', author: 'Test', shortSha: 'abc1234', subject: `tip of ${name}` })
const WORKTREE = { kind: 'folder', path: '/fixture/repo-c-wt' }

async function openChangeBranch(): Promise<ReturnType<typeof renderApp>> {
  // The folder is a worktree on `feature/wt`; `repo-c`, which has `main`, is the main checkout.
  const app = renderApp({ refs: { local: [ref('feature/wt'), ref('main'), ref('dev')] } })
  await app
  await until(() => folderRow('repo-c-wt') !== undefined)
  // A real right-click leaves the row focused, which is where the menu's dialogs give focus back.
  folderRow('repo-c-wt')!.focus()
  await rightClick(folderRow('repo-c-wt')!)
  await userEvent.click(page.getByTestId('context-menu-change-branch'))
  await expect.element(page.getByTestId('branch-switcher-heading')).toHaveTextContent('Change the branch of repo-c-wt')
  return app
}

describe('changing a folder\'s branch from the sidebar', () => {
  it('checks the picked branch out in that folder, with no session open there', async () => {
    const { fake } = await openChangeBranch()
    await userEvent.click(page.getByTestId('branch-switcher-branch-row').getByText('dev', { exact: true }))

    await until(() => fake.callsTo('gitCheckoutBranch').length === 1)
    expect(fake.callsTo('gitCheckoutBranch')).toEqual([[WORKTREE, 'dev']])
    await expect.element(page.getByTestId('branch-switcher')).not.toBeInTheDocument()
  })

  it('takes a branch another worktree has by switching that worktree to another branch in the same step', async () => {
    const { fake } = await openChangeBranch()
    fake.override('gitCheckoutBranch', async (_target, name) => (
      name === 'main'
        ? { ok: false, conflict: { branch: 'main', worktreePath: '/fixture/repo-c', label: 'repo-c', current: 'feature/wt', choices: ['feature/wt', 'dev'] } }
        : { ok: true }
    ))
    await userEvent.click(page.getByTestId('branch-switcher-branch-row').getByText('main', { exact: true }))

    // Not an error: where it is, and what that worktree could have instead — this folder's own
    // branch first, as a swap.
    await expect.element(page.getByTestId('worktree-conflict-dialog')).toBeVisible()
    const rows = (): string[] => [...document.querySelectorAll('[data-testid="worktree-conflict-choice"]')].map((r) => r.textContent ?? '')
    const chosen = (): string | null | undefined => document.querySelector('[data-testid="worktree-conflict-choice"][data-active="true"]')?.getAttribute('data-branch')
    expect(rows()).toEqual(['feature/wtswap with this one', 'dev'])
    expect(chosen()).toBe('feature/wt')

    await userEvent.click(page.getByTestId('worktree-conflict-choice').filter({ hasText: 'dev' }))
    expect(chosen()).toBe('dev')
    await userEvent.click(page.getByTestId('worktree-conflict-move'))

    await until(() => fake.callsTo('gitCheckoutBranchMovingOther').length === 1)
    expect(fake.callsTo('gitCheckoutBranchMovingOther')).toEqual([[WORKTREE, 'main', 'dev']])
    await expect.element(page.getByTestId('worktree-conflict-dialog')).not.toBeInTheDocument()
    await expect.poll(() => document.querySelector('[data-testid="notification-message"]')?.textContent)
      .toBe('Switched repo-c to dev and checked out main.')
  })

  it('searches the branches the other worktree could take, and Enter takes the highlighted one', async () => {
    const { fake } = await openChangeBranch()
    const choices = ['feature/wt', 'dev', 'fix/ci-setup', 'fix/plot-layout', 'chore/cleanup']
    fake.override('gitCheckoutBranch', async (_target, name) => (
      name === 'main'
        ? { ok: false, conflict: { branch: 'main', worktreePath: '/fixture/repo-c', label: 'repo-c', current: 'feature/wt', choices } }
        : { ok: true }
    ))
    await userEvent.click(page.getByTestId('branch-switcher-branch-row').getByText('main', { exact: true }))
    const search = page.getByTestId('worktree-conflict-search')
    // Ready to type: the search box has focus as the dialog opens, and keeps it once the closed
    // branch picker's focus restore has run a frame later (it used to land on the sidebar row).
    await expect.element(search).toHaveFocus()
    await stays(() => document.activeElement === search.element(), 100, 'the search box to keep focus')

    await userEvent.keyboard('fix/')
    const rows = (): (string | null)[] => [...document.querySelectorAll('[data-testid="worktree-conflict-choice"]')].map((r) => r.getAttribute('data-branch'))
    await expect.poll(rows).toEqual(['fix/ci-setup', 'fix/plot-layout'])
    // The highlight stays on a row still shown, and the arrow keys move it.
    const summary = (): string[] => [...document.querySelectorAll('[data-testid="worktree-conflict-summary"] > span')].map((s) => s.textContent ?? '')
    await expect.poll(summary).toEqual(['repo-c → fix/ci-setup', 'here → main'])
    await userEvent.keyboard('{ArrowDown}')
    await expect.poll(summary).toEqual(['repo-c → fix/plot-layout', 'here → main'])

    await userEvent.fill(search, 'nothing like it')
    await expect.element(page.getByTestId('worktree-conflict-none')).toBeVisible()
    await expect.element(page.getByTestId('worktree-conflict-move')).toBeDisabled()

    await userEvent.fill(search, 'plot')
    await userEvent.keyboard('{Enter}')
    await until(() => fake.callsTo('gitCheckoutBranchMovingOther').length === 1)
    expect(fake.callsTo('gitCheckoutBranchMovingOther')).toEqual([[WORKTREE, 'main', 'fix/plot-layout']])
  })

  it('says in full what Switch both will do, however long the branch names', async () => {
    const { fake } = await openChangeBranch()
    const long = '2317-species-list-field-change-test-with-a-much-longer-tail-than-fits-on-one-line'
    fake.override('gitCheckoutBranch', async (_target, name) => (
      name === 'main'
        ? { ok: false, conflict: { branch: 'main', worktreePath: '/fixture/repo-c', label: 'repo-c', current: null, choices: [long] } }
        : { ok: true }
    ))
    await userEvent.click(page.getByTestId('branch-switcher-branch-row').getByText('main', { exact: true }))
    const summary = page.getByTestId('worktree-conflict-summary')
    await expect.element(summary).toBeVisible()
    // It wraps rather than clipping the end of the name, which is usually the part that differs.
    for (const line of [summary.element(), ...summary.element().querySelectorAll('span')]) {
      expect(line.scrollWidth).toBeLessThanOrEqual(line.clientWidth)
    }
    expect(summary.element().textContent).toContain(long)
  })

  it('is not offered for a folder that is not a git repository', async () => {
    await renderApp()
    await until(() => folderRow('work-a') !== undefined)
    await rightClick(folderRow('work-a')!)
    await expect.element(page.getByTestId('context-menu-show-all-worktrees')).toBeVisible()
    expect(document.querySelector('[data-testid="context-menu-change-branch"]')).toBeNull()
  })
})
