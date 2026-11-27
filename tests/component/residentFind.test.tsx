import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { until } from './helpers'
import { message, withRegent } from './residentFixtures'

const FIND = '{Meta>}f{/Meta}'
const popup = (): HTMLElement | null => document.querySelector('[data-testid="resident-popup"]')
const highlighted = (name: string): number => CSS.highlights.get(name)?.size ?? 0

async function openRegent(): Promise<void> {
  await renderApp({}, (f) => {
    withRegent(f, {
      history: [
        message('user', 'Where is the pipeline work?'),
        message('assistant', 'The pipeline fix is in !1800; the pipeline docs are in !1785.'),
        message('user', 'And the deploy?'),
        message('assistant', 'The deploy waits on the pipeline.'),
      ],
    })
  })
  await until(() => document.querySelector('[data-testid="resident-badge-regent"]') !== null)
  await userEvent.click(document.querySelector('[data-testid="resident-badge-regent"]')!)
  await until(() => popup()?.textContent.includes('deploy waits') === true)
}

describe('find in a resident\'s chat', () => {
  it('Cmd/Ctrl+F in the popup finds in its conversation, counts and steps through the matches', async () => {
    await openRegent()
    await userEvent.click(page.getByTestId('resident-conversation'))
    await userEvent.keyboard(FIND)
    await expect.element(page.getByTestId('resident-popup').getByTestId('find-input')).toHaveFocus()
    await userEvent.keyboard('pipeline')
    await expect.element(page.getByTestId('find-count')).toHaveTextContent('4 of 4')
    expect(highlighted('transcript-find')).toBe(4)
    await userEvent.keyboard('{Enter}')
    await expect.element(page.getByTestId('find-count')).toHaveTextContent('3 of 4')
    await userEvent.keyboard('{Escape}')
    await expect.poll(() => document.querySelector('[data-testid="find-bar"]')).toBeNull()
    expect(highlighted('transcript-find')).toBe(0)
  })

  it('works from the message box too', async () => {
    await openRegent()
    await until(() => document.activeElement === document.querySelector('.resident-popup-input'))
    await userEvent.keyboard(FIND)
    await expect.element(page.getByTestId('resident-popup').getByTestId('find-input')).toHaveFocus()
  })
})
