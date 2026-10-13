import { describe, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from '../renderApp'
import { sidebarSession, until } from '../helpers'
import { reviewUi } from './review'

/**
 * The shell bar as the footer of its session's card: closed, open with a terminal, under a second
 * pane stacked above/below it (so the join reads against the neighbour), and with a long branch
 * name in a narrow pane (the name gives way before the copy button and the right group do).
 */
const BRANCH = 'feature/2696-paratoo-oom-phase2-combined-with-a-long-tail'
const THEMES = ['default', 'paper', 'glass'] as const

async function openSession(): Promise<void> {
  await renderApp({}, (fake) => {
    const project = fake.state.projects.find((p) => p.path === '/fixture/repo-c-wt')
    if (project !== undefined) project.branch = BRANCH
  })
  await userEvent.click(sidebarSession('Worktree session'))
  await until(() => document.querySelector('[data-testid="toolbar-branch-button"]') !== null)
}

const openShell = async (): Promise<void> => {
  await userEvent.click(page.getByTestId('shell-toggle'))
  await until(() => document.querySelector('[data-testid="terminal-shell"]') !== null)
}

const card = (): Element | null => document.querySelector('[data-testid="session-card"]')

describe('shell bar', () => {
  it('closed, the bar is the card footer', async () => {
    await openSession()
    await reviewUi('shell bar closed', { widths: [620, 1000], themes: [...THEMES], within: card })
  })

  it('open with a terminal', async () => {
    await openSession()
    await openShell()
    await reviewUi('shell bar open', { widths: [620, 1000], themes: [...THEMES], within: card })
  })

  it('two stacked panes: the bar joins its own card, not the next one', async () => {
    await openSession()
    await userEvent.click(page.getByTestId('session-tab-split'))
    await until(() => page.getByTestId('session-column').elements().length === 2)
    await userEvent.click(page.getByTestId('window-layout-button'))
    await userEvent.click(page.getByTestId('layout-option-halves-v'))
    await until(() => document.querySelector('[data-testid="content"]')?.getAttribute('data-preset') === 'halves-v')
    await reviewUi('shell bar stacked panes', { widths: [900, 1400], themes: [...THEMES] })
  })

  it('the "..." menu with its Branch submenu open stays inside the window', async () => {
    await openSession()
    await reviewUi('shell bar branch submenu', {
      widths: [900, 1400],
      themes: [...THEMES],
      // Opened after each resize: the menu measures where it fits as it opens.
      open: async () => {
        await userEvent.click(page.getByTestId('toolbar-git-menu'))
        await userEvent.click(page.getByTestId('git-menu-branch'))
        await until(() => document.querySelector('[data-testid="git-submenu"]') !== null)
      },
      close: async () => {
        await userEvent.keyboard('{Escape}')
        await userEvent.keyboard('{Escape}')
        await until(() => document.querySelector('[data-testid="git-menu"]') === null)
      },
    })
  })

  it('a long branch name in a narrow pane', async () => {
    await openSession()
    await openShell()
    await reviewUi('shell bar narrow', { widths: [620, 760], themes: ['default', 'glass'], within: card })
  })
})
