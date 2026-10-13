import { describe, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import type { ActivityStatus } from '@shared/activity'
import { renderApp } from '../renderApp'
import { sidebarSession, until } from '../helpers'
import { reviewUi } from './review'

/** A working session is obvious: the Active section's rows and a pane's tabs, running, waiting and idle. */
const STATUS: Record<string, ActivityStatus> = {
  '11111111-1111-1111-1111-111111111111': 'running',
  '22222222-2222-2222-2222-222222222222': 'waiting',
}

async function openThree(): Promise<void> {
  await renderApp({}, (f) => {
    f.override('activeTabs', async () => f.state.tabs.map((t) => ({ ...t, status: STATUS[t.key] ?? 'idle' })))
  })
  for (const title of ['Fix CSV export bug', 'Add worktree switcher', 'Repo root session']) {
    await userEvent.click(sidebarSession(title))
  }
  await until(() => document.querySelectorAll('[data-testid="session-tab"][data-activity="running"]').length === 1)
  await until(() => document.querySelectorAll('[data-testid="session-tab"][data-activity="waiting"]').length === 1)
}

describe('UI working sessions', () => {
  it('working tabs and rows', async () => {
    await openThree()
    await reviewUi('working tabs and rows', { widths: [620, 1400] })
  })

  it('working tabs narrow', async () => {
    await openThree()
    await reviewUi('working tabs narrow', { widths: [620, 760], themes: ['default'] })
  })
})
