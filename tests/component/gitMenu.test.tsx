import { describe, it, expect } from 'vitest'
import { page, userEvent } from '@vitest/browser/context'
import { renderApp } from './renderApp'
import { sidebarSession } from './helpers'

describe('the git "..." menu', () => {
  async function open(): Promise<void> {
    await renderApp()
    await userEvent.click(sidebarSession('Repo root session'))
    await userEvent.click(page.getByTestId('shell-toggle'))
    await expect.element(page.getByTestId('terminal-shell')).toBeVisible()
  }

  it('the "..." menu groups the git commands, with Branch as a submenu', async () => {
    await open()
    await userEvent.click(page.getByTestId('toolbar-git-menu'))
    const menu = page.getByTestId('git-menu')
    await expect.element(menu).toBeVisible()
    await expect.element(menu.getByTestId('git-menu-pull')).toBeVisible()
    await expect.element(menu.getByTestId('git-menu-push')).toBeVisible()
    await expect.element(menu.getByTestId('git-menu-fetch')).toBeVisible()

    // The branch commands live one level in, rather than all being spread across the toolbar.
    await expect.element(page.getByTestId('git-submenu')).not.toBeInTheDocument()
    await userEvent.click(page.getByTestId('git-menu-branch'))
    const submenu = page.getByTestId('git-submenu')
    await expect.element(submenu.getByTestId('git-menu-branch-checkout')).toBeVisible()
    await expect.element(submenu.getByTestId('git-menu-branch-create')).toBeVisible()
    await expect.element(submenu.getByTestId('git-menu-branch-merge')).toBeVisible()
  })

  it('the menu closes on Escape and on a click outside it', async () => {
    await open()
    await userEvent.click(page.getByTestId('toolbar-git-menu'))
    await expect.element(page.getByTestId('git-menu')).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByTestId('git-menu')).not.toBeInTheDocument()

    await userEvent.click(page.getByTestId('toolbar-git-menu'))
    await expect.element(page.getByTestId('git-menu')).toBeVisible()
    await userEvent.click(page.getByTestId('transcript'), { position: { x: 20, y: 20 } })
    await expect.element(page.getByTestId('git-menu')).not.toBeInTheDocument()
  })

  it('Escape closes the branch switcher', async () => {
    await open()
    await userEvent.click(page.getByTestId('toolbar-branch-button'))
    await expect.element(page.getByTestId('branch-switcher')).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByTestId('branch-switcher')).not.toBeInTheDocument()
  })

  it('Escape closes the branch switcher from its create-branch step too', async () => {
    await open()
    await userEvent.click(page.getByTestId('toolbar-git-menu'))
    await userEvent.click(page.getByTestId('git-menu-branch'))
    // "Create Branch..." goes straight to naming, rather than dropping you in the list to find the
    // create action for yourself.
    await userEvent.click(page.getByTestId('git-menu-branch-create'))
    await expect.element(page.getByTestId('branch-switcher-name-input')).toBeVisible()

    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByTestId('branch-switcher')).not.toBeInTheDocument()
  })
})
