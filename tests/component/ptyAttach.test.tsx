import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { until } from './helpers'

/**
 * MAIN-26 step 2: main sends a pty's output only to windows that have it attached — a mounted
 * TerminalView attaches before it asks for the snapshot, and detaches when it unmounts.
 */
async function openNewSession(): Promise<Awaited<ReturnType<typeof renderApp>>['fake']> {
  const { fake } = await renderApp()
  const toggle = [...document.querySelectorAll<HTMLElement>('[data-testid="project-toggle"]')]
    .find((t) => t.querySelector('.project-label')?.textContent === 'work-a')
  const button = toggle?.closest('[data-testid="project-group"]')
    ?.querySelector<HTMLElement>('[data-testid="new-session-button"]')
  if (button === null || button === undefined) throw new Error('no new-session-button on work-a')
  await userEvent.click(button)
  await expect.element(page.getByTestId('terminal-session')).toBeVisible()
  await until(() => fake.callsTo('ptySnapshot').length > 0)
  return fake
}

describe('TerminalView pty attachment', () => {
  it('attaches the pty it shows', async () => {
    const fake = await openNewSession()
    const ptyId = fake.callsTo('ptySnapshot')[0][0] as string
    expect(fake.callsTo('ptyAttach')).toContainEqual([ptyId])
  })

  it('detaches it when the terminal goes away, so main stops sending this window its output', async () => {
    const fake = await openNewSession()
    const ptyId = fake.callsTo('ptySnapshot')[0][0] as string
    expect(fake.callsTo('ptyDetach')).not.toContainEqual([ptyId])
    await userEvent.click(page.getByTestId('session-tab-close').first())
    await until(() => fake.callsTo('ptyDetach').some((args) => args[0] === ptyId))
    expect(fake.callsTo('ptyDetach')).toContainEqual([ptyId])
  })
})
