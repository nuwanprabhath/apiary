import { describe, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from '../renderApp'
import { sidebarSession, until } from '../helpers'
import { reviewUi } from './review'

/**
 * The shell pane's toolbar (the panel header): at three widths with a long branch name, with the
 * » overflow menu open, and with the pane split in two (each half's toolbar is narrower).
 */
const BRANCH = 'feature/a-really-long-branch-name-for-testing'
const press = async (keys: string): Promise<void> => { await userEvent.keyboard(keys) }

async function openShell(opts: { split?: boolean } = {}): Promise<void> {
  await renderApp({}, (fake) => {
    const project = fake.state.projects.find((p) => p.path === '/fixture/repo-c-wt')
    if (project !== undefined) project.branch = BRANCH
    fake.state.tracking.set(BRANCH, { upstream: true, ahead: 0, behind: 141, pending: 0 })
  })
  await userEvent.click(sidebarSession('Worktree session'))
  await until(() => document.querySelector('[data-testid="transcript"]') !== null)
  await userEvent.click(page.getByTestId('shell-toggle'))
  await until(() => document.querySelector('[data-testid="terminal-shell"]') !== null)
  if (opts.split === true) {
    await userEvent.click(page.getByTestId('session-tab-split'))
    await until(() => page.getByTestId('session-column').elements().length === 2)
    for (const toggle of document.querySelectorAll<HTMLElement>('[data-testid="shell-toggle"]')) {
      if (toggle.getAttribute('title') === 'Show shell') toggle.click()
    }
  }
  await until(() => document.querySelector('[data-testid="toolbar-branch-button"]') !== null)
}

// The audit looks at the shell card (and at the menu, which is on the viewport, not in the card):
// the composer above it has its own known defect at narrow widths.
// (Split in two at 620px the second column runs off the window, which is the grid's own minimum
// width, so the first column is the one audited.)
const card = (): Element | null => document.querySelector('[data-testid="shell-card"]')
const menu = (): Element | null => document.querySelector('[data-testid="overflow-menu"]') ?? card()

const openMenu =async (): Promise<void> => {
  const more = document.querySelector<HTMLButtonElement>('[data-testid="overflow-menu-button"]')
  if (more !== null && document.querySelector('[role="menu"]') === null) more.click()
  await until(() => more === null || document.querySelector('[data-testid="overflow-menu"]') !== null)
}

describe('shell toolbar', () => {
  it('at three widths, with a long branch name', async () => {
    await openShell()
    await reviewUi('shell toolbar', { widths: [620, 900, 1400], within: card })
  })

  it('with the » menu open at a narrow width', async () => {
    await openShell()
    await reviewUi('shell toolbar overflow menu open', { widths: [620], within: menu, open: openMenu, close: () => press('{Escape}') })
  })

  it('with the pane split in two', async () => {
    await openShell({ split: true })
    await until(() => document.querySelectorAll('[data-testid="shell-card"]').length === 2)
    await reviewUi('shell toolbar split', {
      widths: [760, 1400],
      within: card,
      // A narrow window scrolls its columns sideways; show the first one whole.
      open: () => { card()?.scrollIntoView({ block: 'nearest', inline: 'start' }); return Promise.resolve() },
    })
    await reviewUi('shell toolbar split overflow menu open', { widths: [620], within: menu, open: openMenu, close: () => press('{Escape}') })
  })
})
