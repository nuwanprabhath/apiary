import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { sidebarSession, until } from './helpers'
import { stays } from '../fixtures/stays'

type App = Awaited<ReturnType<typeof renderApp>>

/** Opens a session, starts its terminal and shows it, with `typed` on the terminal's input box. */
async function inTerminal(typed: string | null): Promise<App> {
  const app = await renderApp()
  app.fake.override('terminalTypedInput', async () => typed)
  await userEvent.click(sidebarSession('Fix CSV export bug'))
  await userEvent.click(page.getByTestId('resume-button'))
  await until(() => app.fake.callsTo('resume').length === 1)
  await expect.element(page.getByTestId('view-terminal')).toHaveAttribute('data-active', 'true')
  return app
}

const composer = (): HTMLTextAreaElement => page.getByTestId('composer-input').element() as HTMLTextAreaElement

describe('switching a tab from Terminal to Chat', () => {
  it('carries what was typed in the terminal into an empty composer, caret at the end', async () => {
    await inTerminal('hello world')
    await userEvent.click(page.getByTestId('view-transcript'))
    await expect.element(page.getByTestId('composer-input')).toHaveValue('hello world')
    await until(() => composer().selectionStart === 'hello world'.length)
  })

  it('appends to a draft already in the composer, on a new line, and not twice', async () => {
    await inTerminal('hello world')
    await userEvent.click(page.getByTestId('view-transcript'))
    await expect.element(page.getByTestId('composer-input')).toHaveValue('hello world')
    await userEvent.clear(page.getByTestId('composer-input'))
    await userEvent.type(page.getByTestId('composer-input'), 'first')
    await userEvent.click(page.getByTestId('view-terminal'))
    await userEvent.click(page.getByTestId('view-transcript'))
    await expect.element(page.getByTestId('composer-input')).toHaveValue('first\nhello world')
    await userEvent.click(page.getByTestId('view-terminal'))
    await userEvent.click(page.getByTestId('view-transcript'))
    await stays(() => composer().value === 'first\nhello world', 300, 'the same text is not appended again')
  })

  it('leaves the composer alone when the terminal has nothing typed', async () => {
    const { fake } = await inTerminal(null)
    await userEvent.click(page.getByTestId('view-transcript'))
    await until(() => fake.callsTo('terminalTypedInput').length === 1)
    await stays(() => composer().value === '', 300, 'the composer stays empty')
  })
})
