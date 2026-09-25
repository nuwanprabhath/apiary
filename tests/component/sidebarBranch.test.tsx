import { describe, it, expect } from 'vitest'
import { page, userEvent } from '@vitest/browser/context'
import { renderApp } from './renderApp'
import { sidebarSession, until } from './helpers'
import { FIXTURE_SESSIONS } from './fakeApiary'

/**
 * Which branch the sidebar's hover card is talking about.
 *
 * Reported as a contradiction: the card said `dev/1.0.12` while the bar under the very same
 * session said `dev/1.0.11`. Both were true — one is the branch recorded in the session's JSONL
 * when it ran, the other is the branch its worktree is checked out to today — and both were
 * labelled "Branch".
 */

describe('sidebarBranch', () => {
  it('the branch the session ran on is still shown, named for what it is', async () => {
    // Not dropped: "this session was about dev/1.0.12" is worth knowing. It is just not "Branch".
    await renderApp({
      sessions: [...FIXTURE_SESSIONS, {
        sessionId: '77777777-7777-7777-7777-777777777777',
        title: 'Session from an older branch',
        projectPath: '/fixture/repo-c',
        gitBranch: 'dev/1.0.12',
      }],
    })
    await userEvent.hover(sidebarSession('Session from an older branch'))
    await until(() => page.getByTestId('session-hover-card').elements().length === 1)
    const card = document.querySelector('[data-testid="session-hover-card"]') as HTMLElement
    const ranOn = [...card.querySelectorAll('.hover-card-row')].find((r) => r.textContent?.includes('Ran on') === true)
    expect(ranOn?.textContent).toContain('dev/1.0.12')
  })

  it('a session still on its own branch says it once, not twice', async () => {
    await renderApp()
    await userEvent.hover(sidebarSession('Worktree session'))
    await until(() => page.getByTestId('session-hover-card').elements().length === 1)
    const card = document.querySelector('[data-testid="session-hover-card"]') as HTMLElement
    expect(card.textContent).toContain('feature/wt')
    const ranOn = [...card.querySelectorAll('.hover-card-row')].filter((r) => r.textContent?.includes('Ran on') === true)
    expect(ranOn).toHaveLength(0)
  })
})
