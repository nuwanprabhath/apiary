import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { message, type FakeSession } from './fakeApiary'
import { openBySearch, sidebarSession, stays, until } from './helpers'

const SESSION: FakeSession = {
  sessionId: '00000000-0000-4000-8000-0000000000e1',
  title: 'Palette chat',
  projectPath: '/fixture/work-a',
  gitBranch: 'main',
  messages: [message('u1', 'user', 'Hello'), message('a1', 'assistant', 'Hi')],
}

async function openMenu(opts: { vsCode: boolean; cwdExists?: boolean }): Promise<Awaited<ReturnType<typeof renderApp>>['fake']> {
  const { fake } = await renderApp({
    sessions: [{ ...SESSION, cwdExists: opts.cwdExists ?? true }],
    vsCode: opts.vsCode,
    settings: { transcriptChat: true },
  })
  // A session whose folder is gone is not in the tree; search still finds it.
  if (opts.cwdExists === false) await openBySearch('Palette chat')
  else await userEvent.click(sidebarSession('Palette chat'))
  await expect.element(page.getByTestId('composer-commands')).toBeVisible()
  await userEvent.click(page.getByTestId('composer-commands'))
  await expect.element(page.getByTestId('composer-command-menu')).toBeVisible()
  return fake
}

const headings = (): string[] => [...document.querySelectorAll('.chat-menu-heading')].map((e) => e.textContent ?? '')
const items = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-testid="composer-action-option"]')]

describe('the "/" menu Actions group', () => {
  it('lists Open in VS Code under Actions and opens the session folder on click', async () => {
    const fake = await openMenu({ vsCode: true })
    await expect.poll(headings).toContain('Actions')
    expect(items().map((e) => e.textContent)).toEqual([expect.stringContaining('Open in VS Code')])
    await userEvent.click(page.getByTestId('composer-action-option'))
    await until(() => fake.callsTo('openInVsCode').length === 1)
    expect(fake.callsTo('openInVsCode')).toEqual([[{ kind: 'session', id: SESSION.sessionId }]])
    await expect.element(page.getByTestId('composer-command-menu')).not.toBeInTheDocument()
    await expect.poll(() => document.activeElement).toBe(page.getByTestId('composer-input').element())
  })

  it('is found by "vs" and chosen with Enter', async () => {
    const fake = await openMenu({ vsCode: true })
    await userEvent.fill(page.getByTestId('composer-command-search'), 'vs')
    await expect.poll(() => items().length).toBe(1)
    await userEvent.keyboard('{Enter}')
    await until(() => fake.callsTo('openInVsCode').length === 1)
    await expect.element(page.getByTestId('composer-command-menu')).not.toBeInTheDocument()
  })

  it('is absent without VS Code', async () => {
    await openMenu({ vsCode: false })
    await stays(() => items().length === 0 && !headings().includes('Actions'), 300, 'no Actions without VS Code')
  })

  it('is absent when the session folder is gone', async () => {
    await openMenu({ vsCode: true, cwdExists: false })
    await stays(() => items().length === 0 && !headings().includes('Actions'), 300, 'no Actions without the folder')
  })
})
