import { describe, it, expect } from 'vitest'
import { userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { sidebarSession, mouse, until } from './helpers'

const TITLES = ['Fix CSV export bug', 'Add worktree switcher', 'Repo root session']

const all = (id: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)]
const button = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-testid="session-tab-list"]')
const rows = (): HTMLElement[] => all('tab-list-row')
const strip = (): string[] => all('session-tab-label').map((t) => t.textContent.trim())
const rowTitles = (): string[] => rows().map((r) => r.querySelector('[data-testid="tab-list-title"]')!.textContent.trim())

/** Opens `titles` from the standard sessions, or, given `extra`, that many generated sessions instead. */
async function openTabs(titles: string[], extra: number = 0): Promise<void> {
  const sessions = Array.from({ length: extra }, (_, i) => ({
    sessionId: `aaaaaaaa-0000-0000-0000-${String(i).padStart(12, '0')}`,
    title: `Extra session ${i + 1}`,
    projectPath: '/fixture/work-a',
  }))
  await renderApp(extra > 0 ? { sessions } : {})
  for (const title of extra > 0 ? sessions.map((s) => s.title) : titles) await userEvent.click(sidebarSession(title))
  await mouse.move(1, 1)
}

async function openMenu(): Promise<void> {
  await userEvent.click(button()!)
  await until(() => document.querySelector('[data-testid="tab-list-menu"]') !== null)
}

describe('tab list menu', () => {
  it('lists every tab of the pane in order with the active one marked', async () => {
    await openTabs(TITLES)
    await openMenu()
    expect(rowTitles()).toEqual(strip())
    expect(rowTitles()).toEqual(TITLES)
    const current = rows().filter((r) => r.getAttribute('aria-current') === 'true')
    expect(current).toHaveLength(1)
    expect(current[0].textContent).toContain('Repo root session')
    expect(button()!.getAttribute('aria-label')).toBe('All tabs')
  })

  it('choosing a row selects that tab and closes the menu', async () => {
    await openTabs(TITLES)
    await openMenu()
    await userEvent.click(rows()[0])
    await until(() => document.querySelector('[data-testid="tab-list-menu"]') === null)
    expect(all('session-tab').find((t) => t.dataset.active === 'true')!.textContent).toContain('Fix CSV export bug')
  })

  it('Alt+ArrowDown moves the highlighted tab one place right in the strip', async () => {
    await openTabs(TITLES)
    await openMenu()
    await userEvent.keyboard('{ArrowUp}{ArrowUp}')
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}')
    await until(() => strip()[1] === 'Fix CSV export bug')
    expect(strip()).toEqual(['Add worktree switcher', 'Fix CSV export bug', 'Repo root session'])
    expect(rowTitles()).toEqual(strip())
    expect(rows().find((r) => r.dataset.highlighted === 'true')!.textContent).toContain('Fix CSV export bug')
    expect(document.querySelector('[data-testid="tab-list-menu"]')).not.toBeNull()
  })

  it('dragging a row to another position reorders the strip', async () => {
    await openTabs(TITLES)
    await openMenu()
    const from = rows()[0].getBoundingClientRect()
    const to = rows()[2].getBoundingClientRect()
    await mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await mouse.down()
    await mouse.move(to.x + to.width / 2, to.y + to.height - 3, 8)
    await mouse.up()
    await until(() => strip()[2] === 'Fix CSV export bug')
    expect(strip()).toEqual(['Add worktree switcher', 'Repo root session', 'Fix CSV export bug'])
    expect(document.querySelector('[data-testid="tab-list-menu"]')).not.toBeNull()
  })

  it('the filter appears above 8 tabs and hides the reorder affordances while it has text', async () => {
    await openTabs([], 9)
    await openMenu()
    const filter = document.querySelector<HTMLInputElement>('[data-testid="tab-list-filter"]')!
    expect(filter).not.toBeNull()
    expect(document.activeElement).toBe(filter)
    expect(rows().every((r) => r.draggable)).toBe(true)
    await userEvent.keyboard('extra session 3')
    await until(() => rows().length === 1)
    expect(rows()[0].draggable).toBe(false)
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}')
    expect(strip().indexOf('Extra session 3')).toBe(2)
    await userEvent.clear(filter)
    await userEvent.keyboard('zzz')
    await until(() => document.querySelector('[data-testid="tab-list-empty"]') !== null)
    expect(document.querySelector('[data-testid="tab-list-empty"]')!.textContent).toBe('No tabs match')
  })

  it('Escape closes and returns focus to the button', async () => {
    await openTabs(TITLES)
    await openMenu()
    await userEvent.keyboard('{Escape}')
    await until(() => document.querySelector('[data-testid="tab-list-menu"]') === null)
    expect(document.activeElement).toBe(button())
  })

  it('the button is hidden with fewer than 2 tabs', async () => {
    await openTabs(['Fix CSV export bug'])
    expect(button()).toBeNull()
    await userEvent.click(sidebarSession('Add worktree switcher'))
    await until(() => button() !== null)
  })
})
