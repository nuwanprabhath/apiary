import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { openClaudeTerminal, ptyWrites, until } from './helpers'

describe('Ctrl+Z in a Claude Code terminal', () => {
  it('asks before suspending, and "don\'t suspend" is the default an Enter picks', async () => {
    const { fake } = await renderApp()
    await openClaudeTerminal(fake)

    await userEvent.keyboard('{Control>}z{/Control}')
    await expect.element(page.getByTestId('suspend-confirm-dialog')).toBeVisible()
    await expect.element(page.getByTestId('suspend-confirm-cancel')).toHaveFocus()

    await userEvent.keyboard('{Enter}')
    await expect.element(page.getByTestId('suspend-confirm-dialog')).not.toBeInTheDocument()
    expect(ptyWrites(fake)).not.toContain('\x1a')
  })

  it('suspends only when that is what was chosen', async () => {
    const { fake } = await renderApp()
    await openClaudeTerminal(fake)

    await userEvent.keyboard('{Control>}z{/Control}')
    await userEvent.click(page.getByTestId('suspend-confirm-suspend'))
    await expect.poll(() => ptyWrites(fake)).toContain('\x1a')
  })

  it('a suspended Claude gets a Resume bar, and keys typed meanwhile never reach its prompt', async () => {
    const { fake } = await renderApp()
    const ptyId = await openClaudeTerminal(fake)

    fake.emit('ptyData', ptyId, 'Claude Code has been suspended. Run `fg` to bring Claude Code back.\r\n'
      + 'Note: ctrl + z now suspends Claude Code, ctrl + _ undoes input.\r\n')
    await expect.element(page.getByTestId('terminal-suspended')).toBeVisible()

    const before = ptyWrites(fake).length
    await userEvent.keyboard('fg')
    expect(ptyWrites(fake).length).toBe(before)

    await userEvent.keyboard('{Enter}')
    await until(() => fake.callsTo('ptyResume').length === 1)
    expect(fake.callsTo('ptyResume')[0][0]).toBe(ptyId)
    await expect.element(page.getByTestId('terminal-suspended')).not.toBeInTheDocument()
  })

  it('the Resume button continues it too', async () => {
    const { fake } = await renderApp()
    const ptyId = await openClaudeTerminal(fake)
    fake.emit('ptyData', ptyId, 'Claude Code has been suspended. Run `fg` to bring Claude Code back.\r\n')
    await userEvent.click(page.getByTestId('terminal-resume'))
    await expect.poll(() => fake.callsTo('ptyResume')).toEqual([[ptyId]])
  })
})

describe('Ctrl+Z in a shell terminal', () => {
  it('goes straight through: a shell has job control of its own', async () => {
    const { fake } = await renderApp()
    await openClaudeTerminal(fake)
    await userEvent.click(page.getByTestId('shell-toggle'))
    await expect.element(page.getByTestId('terminal-shell')).toBeVisible()
    await userEvent.click(page.getByTestId('terminal-shell'))

    await userEvent.keyboard('{Control>}z{/Control}')
    await until(() => ptyWrites(fake).includes('\x1a'))
    expect(document.querySelector('[data-testid="suspend-confirm-dialog"]')).toBeNull()
  })
})
