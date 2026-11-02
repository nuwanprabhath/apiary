import { userEvent } from 'vitest/browser'
import { THIS_WINDOW } from '../contract/world'
import type { FakeApiary } from './fakeApiary'
import { until } from './helpers'
import { openLayout, panes } from './paneFoldSetup'

export const TITLES = ['Fix CSV export bug', 'Add worktree switcher', 'Repo root session', 'Worktree session']

export function railButton(pane: Element): HTMLElement | null {
  return pane.querySelector<HTMLElement>('[data-testid="pane-rail-collapse"]')
}

export function expandButton(pane: Element): HTMLElement | null {
  return pane.querySelector<HTMLElement>('[data-testid="pane-rail-expand"]')
}

export const card = (pane: Element): HTMLElement => pane.querySelector<HTMLElement>('[data-testid="session-card"]')!

/** Three columns, every one holding a session: the first keeps two tabs, the others take one each
 *  from the waiting panes' "move here" list. */
export async function openThirds(titles: string[] = TITLES): Promise<HTMLElement[]> {
  await openLayout('thirds-h', titles)
  for (const index of [1, 2]) {
    const tab = panes()[index].querySelector<HTMLElement>('[data-testid="pane-filler-tab"]')!
    await userEvent.click(tab)
    await until(() => panes()[index].getAttribute('data-placeholder') === 'false')
  }
  return panes()
}

export async function collapse(pane: HTMLElement): Promise<void> {
  await userEvent.click(railButton(pane)!)
  await until(() => pane.getAttribute('data-rail') === 'true')
}

/** Says the tab `key` is `status`, as main's activity broadcast would. */
export function markStatus(fake: FakeApiary, key: string, status: 'running' | 'waiting'): void {
  const others = fake.state.tabs.filter((t) => t.key !== key)
  fake.state.tabs = [...others, { windowNumber: THIS_WINDOW.number, key, view: 'transcript', status, label: null }]
  fake.emit('activeTabsChanged')
}
