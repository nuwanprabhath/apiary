import { page, userEvent } from 'vitest/browser'
import type { FakeApiary } from './fakeApiary'
import { sidebarSession, until } from './helpers'

export function panes(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-testid="session-column"]')]
}

export function foldButton(pane: Element): HTMLElement | null {
  return pane.querySelector<HTMLElement>('[data-testid="pane-collapse"]')
}

/** Opens `titles` as tabs of the first pane, then arranges the window as `preset` (the other zones
 *  wait to be filled). */
export async function openLayout(preset: string, titles: string[] = ['Fix CSV export bug']): Promise<void> {
  for (const title of titles) await userEvent.click(sidebarSession(title))
  await until(() => document.querySelectorAll('[data-testid="session-tab"]').length === titles.length)
  await userEvent.click(page.getByTestId('window-layout-button'))
  await userEvent.click(page.getByTestId(`layout-option-${preset}`).first())
  await until(() => document.querySelector('[data-testid="content"]')?.getAttribute('data-preset') === preset)
  await userEvent.keyboard('{Escape}')
  await until(() => document.querySelector('[data-testid="layout-picker"]') === null)
}

/** Says the tab `key` is running, as main's activity broadcast would. */
export function markRunning(fake: FakeApiary, key: string): void {
  fake.state.tabs = fake.state.tabs.map((t) => (t.key === key ? { ...t, status: 'running' } : t))
  fake.emit('activeTabsChanged')
}
