import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { until } from './helpers'
import type { FakeApiary } from './fakeApiary'

async function rightClick(el: Element): Promise<void> {
  const { x, y, width, height } = el.getBoundingClientRect()
  el.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, clientX: x + width / 2, clientY: y + height / 2,
  }))
}

/** Every group assignment main holds in its library state, folder path → group id. */
const savedAssignments = (fake: FakeApiary): Record<string, string> => fake.state.library.state.groupAssignments

describe('"+" on a user-created group', () => {
  it('starts a session in a folder picked with the native dialog, and files that folder under the group', async () => {
    const { fake } = await renderApp()
    await until(() => document.querySelector('.project-row-wrap[data-depth="0"]') !== null)
    await rightClick(document.querySelector('.project-row-wrap[data-depth="0"]')!)
    await userEvent.click(page.getByTestId('context-menu-new-group'))
    await userEvent.keyboard('{Enter}')
    await expect.element(page.getByTestId('folder-group')).toBeVisible()

    await userEvent.click(page.getByTestId('group-new-session-button'))
    await expect.poll(() => fake.callsTo('newSessionInPickedFolder').length).toBe(1)
    await expect.element(page.getByTestId('terminal-session')).toBeVisible()
    await expect.poll(() => Object.keys(savedAssignments(fake))).toContain('/fixture/picked')
  })

  it('a cancelled picker starts nothing and files nothing', async () => {
    const { fake } = await renderApp()
    fake.override('newSessionInPickedFolder', async () => null)
    await until(() => document.querySelector('.project-row-wrap[data-depth="0"]') !== null)
    await rightClick(document.querySelector('.project-row-wrap[data-depth="0"]')!)
    await userEvent.click(page.getByTestId('context-menu-new-group'))
    await userEvent.keyboard('{Enter}')
    await userEvent.click(page.getByTestId('group-new-session-button'))
    await expect.poll(() => fake.callsTo('newSessionInPickedFolder').length).toBe(1)
    expect(document.querySelector('[data-testid="terminal-session"]')).toBeNull()
    expect(Object.keys(savedAssignments(fake))).not.toContain('/fixture/picked')
  })
})
