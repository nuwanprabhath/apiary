import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { until } from './helpers'

async function rightClick(el: Element): Promise<void> {
  const { x, y, width, height } = el.getBoundingClientRect()
  el.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, clientX: x + width / 2, clientY: y + height / 2,
  }))
}

/** Every group assignment the window has persisted, folder path → group id. */
function savedAssignments(): Record<string, string> {
  const out: Record<string, string> = {}
  for (let i = 0; i < localStorage.length; i++) {
    const raw = localStorage.getItem(localStorage.key(i) ?? '') ?? ''
    try {
      Object.assign(out, (JSON.parse(raw) as { groupAssignments?: Record<string, string> }).groupAssignments ?? {})
    } catch { /* not ours */ }
  }
  return out
}

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
    await expect.poll(() => Object.keys(savedAssignments())).toContain('/fixture/picked')
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
    expect(Object.keys(savedAssignments())).not.toContain('/fixture/picked')
  })
})
