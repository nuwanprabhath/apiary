import { describe, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import type { ActivityStatus } from '@shared/activity'
import { renderApp } from '../renderApp'
import { sidebarSession, until } from '../helpers'
import { reviewUi } from './review'

/** The Active section expanded and collapsed, the collapsed header with a session working. */
const STATUS: Record<string, ActivityStatus> = {
  '11111111-1111-1111-1111-111111111111': 'running',
  '22222222-2222-2222-2222-222222222222': 'waiting',
}

async function openThree(collapsed: boolean): Promise<void> {
  await renderApp({ library: { activeCollapsed: collapsed } }, (f) => {
    f.override('activeTabs', async () => f.state.tabs.map((t) => ({ ...t, status: STATUS[t.key] ?? 'idle' })))
  })
  for (const title of ['Fix CSV export bug', 'Add worktree switcher', 'Repo root session']) {
    await userEvent.click(sidebarSession(title))
  }
  await until(() => document.querySelector('[data-testid="active-header"]')?.textContent?.includes('3') === true)
}

describe('UI Active section collapse', () => {
  it('active expanded', async () => {
    await openThree(false)
    await until(() => document.querySelectorAll('.active-row-wrap').length === 3)
    await reviewUi('active expanded', { widths: [620, 1400] })
  })

  it('active collapsed with a working session', async () => {
    await openThree(true)
    await until(() => document.querySelector('[data-testid="active-collapsed-working"]') !== null)
    await reviewUi('active collapsed', { widths: [620, 1400] })
  })
})
