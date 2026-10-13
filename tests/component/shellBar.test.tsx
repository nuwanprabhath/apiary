import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { sidebarSession, until } from './helpers'
import type { FakeApiary } from './fakeApiary'

/**
 * The shell bar is the footer of its session's card, not a card of its own: no gap between the
 * session and the bar, one outline around both, a short message-box row, and the copy-branch
 * button beside the branch it copies.
 */
async function open(): Promise<FakeApiary> {
  const { fake } = await renderApp()
  await userEvent.click(sidebarSession('Fix CSV export bug'))
  await until(() => document.querySelector('.composer-actions') !== null)
  await until(() => document.querySelector('[data-testid="toolbar-branch-button"]') !== null)
  return fake
}

const q = (sel: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(sel)
  if (el === null) throw new Error(`No ${sel}`)
  return el
}

describe('the shell bar', () => {
  it('sits inside its session card with no gap below the message box', async () => {
    await open()
    const card = q('[data-testid="session-card"]')
    const bar = q('[data-testid="shell-card"]')
    expect(card.contains(bar)).toBe(true)
    const composer = q('.composer').getBoundingClientRect()
    expect(Math.abs(bar.getBoundingClientRect().top - composer.bottom)).toBeLessThanOrEqual(1)
    expect(bar.getBoundingClientRect().bottom).toBeLessThanOrEqual(card.getBoundingClientRect().bottom + 1)
  })

  it('leaves at most --space-sm under the message box row', async () => {
    await open()
    const probe = document.body.appendChild(document.createElement('div'))
    probe.style.width = 'var(--space-sm)'
    const sm = probe.getBoundingClientRect().width
    probe.remove()
    const row = q('.composer-actions').getBoundingClientRect()
    const bar = q('[data-testid="shell-card"]').getBoundingClientRect()
    expect(bar.top - row.bottom).toBeLessThanOrEqual(sm + 1)
  })

  it('puts the copy button right after the branch name and copies it', async () => {
    const fake = await open()
    const branch = q('[data-testid="toolbar-branch-button"]')
    const copy = q('[data-testid="toolbar-copy"]')
    expect(branch.nextElementSibling).toBe(copy)
    expect(copy.getBoundingClientRect().left).toBeGreaterThanOrEqual(branch.getBoundingClientRect().right - 1)
    await userEvent.click(page.getByTestId('toolbar-copy'))
    expect(fake.callsTo('copyToClipboard')).toHaveLength(1)
  })
})
