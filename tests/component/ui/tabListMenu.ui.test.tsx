import { describe, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import type { ActivityStatus } from '@shared/activity'
import { renderApp } from '../renderApp'
import { sidebarSession, until } from '../helpers'
import { reviewUi } from './review'

/** The tab list: many tabs with long titles and the filter, a few tabs, and a pane too narrow for the button. */
const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `bbbbbbbb-0000-0000-0000-${String(i).padStart(12, '0')}`)
const LONG = 'Investigate why the nightly export job times out when the worktree has more than forty thousand files'
const card = (): Element | null => document.querySelector('[data-testid="session-card"]')
const menu = (): Element | null => document.querySelector('[data-testid="tab-list-menu"]')

async function openTabs(count: number): Promise<void> {
  const sessionIds = ids(count)
  const sessions = sessionIds.map((sessionId, i) => ({
    sessionId,
    title: i % 3 === 0 ? `${LONG} (${String(i + 1)})` : `Session number ${String(i + 1)}`,
    projectPath: '/fixture/work-a',
  }))
  const status: Record<string, ActivityStatus> = { [sessionIds[1]]: 'running', [sessionIds[2]]: 'waiting' }
  await renderApp({ sessions }, (f) => {
    f.override('activeTabs', async () => f.state.tabs.map((t) => ({ ...t, status: status[t.key] ?? 'idle' })))
  })
  for (const s of sessions) await userEvent.click(sidebarSession(s.title))
  await until(() => document.querySelectorAll('[data-testid="session-tab"][data-activity="running"]').length === 1)
}

/** The button hides in a pane under 140px of strip (the 620px pass), where there is nothing to open. */
const buttonShown = (): boolean => (document.querySelector<HTMLElement>('[data-testid="session-tab-list"]')?.offsetParent ?? null) !== null
const open = async (): Promise<void> => {
  if (!buttonShown()) return
  if (menu() === null) await userEvent.click(page.getByTestId('session-tab-list'))
  await until(() => menu() !== null)
}
const close = async (): Promise<void> => {
  if (menu() === null) return
  await userEvent.keyboard('{Escape}')
  await until(() => menu() === null)
}

describe('UI tab list menu', () => {
  it('tab list twelve tabs with the filter', async () => {
    await openTabs(12)
    await reviewUi('tab list twelve tabs', { widths: [900, 1400], open, close, within: card })
  })

  it('tab list three tabs', async () => {
    await openTabs(3)
    await reviewUi('tab list three tabs', { widths: [900], open, close, within: card })
  })

  it('tab list in a narrow split pane', async () => {
    await openTabs(3)
    await userEvent.click(page.getByTestId('session-tab-split').first())
    await until(() => document.querySelectorAll('[data-testid="session-tab-bar"]').length >= 2)
    await userEvent.unhover(page.getByTestId('session-tab-split').first())
    await userEvent.keyboard('{Escape}')
    await reviewUi('tab list narrow pane', { widths: [620], within: card })
  })
})
