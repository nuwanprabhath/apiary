import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { sidebarSession, box, until } from './helpers'
import { FIXTURE_SESSIONS } from './fakeApiary'

const open = async (): Promise<Awaited<ReturnType<typeof renderApp>>> => {
  const app = await renderApp()
  await userEvent.click(sidebarSession('Fix CSV export bug'))
  await expect.element(page.getByTestId('view-toggle')).toBeVisible()
  return app
}

describe('the Chat | Terminal toggle', () => {
  it('replaces the path row and the resume bar: the folder is in the title tooltip', async () => {
    await open()
    expect(document.querySelector('[data-testid="session-path"], .session-cwd, .resume-bar')).toBeNull()
    const title = page.getByTestId('session-title').element()
    const cwd = title.getAttribute('data-cwd') ?? ''
    expect(cwd).not.toBe('')
    expect(title.getAttribute('title')?.split('\n')[1]).toBe(cwd)
  })

  it('shows Chat in front; Terminal starts the session, then the two segments switch the view', async () => {
    const { fake } = await open()
    await expect.element(page.getByTestId('view-transcript')).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(page.getByTestId('resume-button'))
    await until(() => fake.callsTo('resume').length === 1)
    await expect.element(page.getByTestId('view-terminal')).toHaveAttribute('data-active', 'true')
    expect(document.querySelector('[data-testid="session-live-dot"]')).not.toBeNull()
    await userEvent.click(page.getByTestId('view-transcript'))
    await expect.element(page.getByTestId('view-transcript')).toHaveAttribute('data-active', 'true')
    await userEvent.click(page.getByTestId('view-terminal'))
    await expect.element(page.getByTestId('view-terminal')).toHaveAttribute('data-active', 'true')
  })

  it('is two real buttons a keyboard can reach and press', async () => {
    const { fake } = await open()
    const chat = page.getByTestId('view-transcript').element()
    chat.focus()
    await userEvent.tab()
    expect(document.activeElement).toBe(page.getByTestId('resume-button').element())
    await userEvent.keyboard('{Enter}')
    await until(() => fake.callsTo('resume').length === 1)
  })

  it('disables Terminal, with the reason, when the folder is gone', async () => {
    await renderApp({
      sessions: FIXTURE_SESSIONS.map((s) => (s.title === 'Fix CSV export bug' ? { ...s, cwdExists: false } : s)),
    })
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await expect.element(page.getByTestId('resume-button')).toBeDisabled()
    expect(page.getByTestId('resume-button').element().getAttribute('title')).toBe('This folder no longer exists')
  })

  it('leaves the transcript just under the tab bar: no second and third header row', async () => {
    await open()
    const gap = box(page.getByTestId('transcript')).y - box(page.getByTestId('session-tab-bar')).bottom
    // The title row alone; before, the path and resume rows sat on top of it (about 3 rows).
    expect(gap).toBeLessThan(60)
  })
})
