import { describe, it, expect, onTestFinished } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { fakePet, type FakeApiary } from './fakeApiary'
import { drag, sidebarSession, until } from './helpers'
import type { PetsState } from '@shared/pets/state'
import type { ActiveTabPayload } from '@shared/domain/tabs'

/**
 * The pets in the window: where they may be, what dragging and the menu do, chatting, and that
 * they react to Claude — through the real brain worker.
 */
function out(fake: FakeApiary, state: Partial<PetsState> = {}): void {
  fake.state.pets = { enabled: true, generating: false, pets: [fakePet('pip', { size: 64 })], ...state }
  fake.emit('petsChanged', fake.state.pets)
}

const rect = (sel: string): DOMRect => document.querySelector(sel)!.getBoundingClientRect()
const pet = (): HTMLElement => document.querySelector<HTMLElement>('[data-testid="pet"]')!
/** A pet is always breathing, so it is never "stable" in Playwright's sense: click it regardless. */
const clickPet = (button: 'left' | 'right' = 'left'): Promise<void> => userEvent.click(page.getByTestId('pet'), { button, force: true })

describe('pets', () => {
  it('there is no layer, and no worker, until pets are on with one out', async () => {
    const { fake } = await renderApp()
    await expect.element(page.getByTestId('sidebar')).toBeVisible()
    expect(document.querySelector('[data-testid="pet-layer"]')).toBeNull()
    out(fake, { enabled: false })
    out(fake, { pets: [fakePet('pip', { active: false })] })
    await expect.element(page.getByTestId('sidebar')).toBeVisible()
    expect(document.querySelector('[data-testid="pet-layer"]')).toBeNull()
    expect(document.querySelector('[data-testid="status-bar"]')).toBeNull()
  })

  it('a pet out stands on the status bar, which is drawn for it even with nothing else on it', async () => {
    const { fake } = await renderApp()
    out(fake)
    await expect.element(page.getByTestId('pet')).toBeVisible()
    await expect.element(page.getByTestId('status-bar')).toBeVisible()
    const floor = rect('[data-testid="status-bar-floor"]')
    await until(() => {
      const p = pet().getBoundingClientRect()
      return Math.abs(p.bottom - (floor.bottom - 2)) <= 1 && p.left >= floor.left - 1 && p.right <= floor.right + 1
    })
  })

  it('dragged to the rail it stays there, is remembered, and comes back down when the sidebar opens', async () => {
    const { fake } = await renderApp()
    await userEvent.click(page.getByTestId('sidebar-hide'))
    await expect.element(page.getByTestId('sidebar-rail')).toBeVisible()
    out(fake)
    await expect.element(page.getByTestId('pet')).toBeVisible()
    const rail = rect('[data-testid="sidebar-rail"]')
    const p = pet().getBoundingClientRect()
    await drag(pet(), rail.x + rail.width / 2 - (p.x + p.width / 2), rail.y + rail.height / 2 - (p.y + p.height / 2), 10)
    await expect.poll(() => fake.callsTo('petUpdate').at(-1)).toEqual(['pip', { place: { region: 'rail', at: expect.any(Number) as number } }])
    await expect.element(page.getByTestId('pet')).toHaveAttribute('data-region', 'rail')
    await userEvent.click(page.getByTestId('sidebar-show'))
    await expect.element(page.getByTestId('pet')).toHaveAttribute('data-region', 'bar')
  })

  it('right-click offers sizes, sleep, putting it away and its settings', async () => {
    const { fake } = await renderApp()
    out(fake)
    await expect.element(page.getByTestId('pet')).toBeVisible()
    await clickPet('right')
    await expect.element(page.getByTestId('pet-menu')).toBeVisible()
    await userEvent.click(page.getByRole('menuitemcheckbox', { name: 'Large' }))
    expect(fake.callsTo('petUpdate').at(-1)).toEqual(['pip', { size: 92 }])
    await expect.poll(() => pet().getBoundingClientRect().width).toBe(92)

    await clickPet('right')
    await userEvent.click(page.getByRole('menuitem', { name: 'Put Pip away' }))
    await expect.poll(() => document.querySelector('[data-testid="pet"]')).toBeNull()
    expect(fake.callsTo('petUpdate').at(-1)).toEqual(['pip', { active: false }])
  })

  it('clicking a pet opens a chat with it', async () => {
    const { fake } = await renderApp()
    fake.state.petReply = 'I love diffs!'
    out(fake)
    await expect.element(page.getByTestId('pet')).toBeVisible()
    await clickPet()
    await expect.element(page.getByTestId('pet-chat')).toBeVisible()
    await userEvent.type(page.getByTestId('pet-chat-input'), 'what do you like?{Enter}')
    const said = (): string[] => [...document.querySelectorAll('[data-testid="pet-chat-line"]')].map((l) => l.textContent)
    await expect.poll(said).toEqual(['what do you like?', 'I love diffs!'])
    expect(fake.callsTo('petChat')).toEqual([['pip', 'what do you like?']])
    await userEvent.keyboard('{Escape}')
    await expect.poll(() => document.querySelector('[data-testid="pet-chat"]')).toBeNull()
  })

  it('pipes up when Claude starts working, through the brain in its worker', async () => {
    const { fake } = await renderApp()
    out(fake)
    await expect.element(page.getByTestId('pet')).toBeVisible()
    const running: ActiveTabPayload = { windowNumber: 1, key: 'session-a', view: 'terminal', status: 'running', label: null }
    fake.state.tabs = [running]
    fake.emit('activeTabsChanged')
    await expect.element(page.getByTestId('pet-bubble')).toBeVisible()
    expect(fake.state.pets.pets[0].spec.lines.working).toContain(document.querySelector('[data-testid="pet-bubble"]')!.textContent)
    await page.screenshot({ path: '../../test-results/pets/in-app.png' })
    await expect.poll(() => document.querySelector('[data-testid="pet"] .pet-sprite')?.getAttribute('data-activity')).toBe('watch')
  })

  it('costs the page a few DOM changes a second at most: walking and breathing are the compositor\'s', async () => {
    const { fake } = await renderApp()
    out(fake, { pets: [fakePet('a'), fakePet('b'), fakePet('c')] })
    await expect.poll(() => document.querySelectorAll('[data-testid="pet"]').length).toBe(3)
    let changes = 0
    const observer = new MutationObserver((records) => { changes += records.length })
    observer.observe(document.querySelector('[data-testid="pet-layer"]')!, { subtree: true, childList: true, attributes: true, characterData: true })
    await new Promise((r) => setTimeout(r, 5000))
    observer.disconnect()
    // Three pets for five seconds: a command now and then per pet, each touching a handful of
    // attributes. A per-frame loop would be thousands.
    expect(changes).toBeLessThan(150)
  })

  /** Scenes and remarks in seconds, not minutes (the brain's test seam). */
  function quickBrain(options: object): void {
    (globalThis as Record<string, unknown>).__apiaryPetBrainOptions = options
    onTestFinished(() => { delete (globalThis as Record<string, unknown>).__apiaryPetBrainOptions })
  }

  /** The session's status as every window reports it — fixed, since the app reports its own tabs too. */
  function claudeIs(fake: FakeApiary, key: string, status: ActiveTabPayload['status']): void {
    fake.override('activeTabs', async () => [{ windowNumber: 1, key, view: 'transcript', status, label: null }])
    fake.emit('activeTabsChanged')
  }

  async function openPane(fake: FakeApiary): Promise<{ key: string; pane: DOMRect }> {
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    const key = fake.state.sessions.find((s) => s.title === 'Fix CSV export bug')!.sessionId
    await expect.poll(() => document.querySelector(`[data-testid="session-column"][data-session-key="${key}"]`)).not.toBeNull()
    return { key, pane: document.querySelector(`[data-session-key="${key}"]`)!.getBoundingClientRect() }
  }

  it('while a session works, a pet goes under it, looks, and says what it makes of what Claude is doing', { timeout: 30_000 }, async () => {
    quickBrain({ commentEveryMs: [800, 1000] })
    const { fake } = await renderApp()
    const { key } = await openPane(fake)
    fake.state.petActions = { [key]: 'Edit: csvWriter.ts' }
    fake.state.petComment = 'Careful with that buffer!'
    out(fake)
    await expect.element(page.getByTestId('pet')).toBeVisible()
    claudeIs(fake, key, 'running')
    await expect.poll(() => [...document.querySelectorAll('[data-testid="pet-bubble"]')].map((b) => b.textContent), { timeout: 25_000 }).toContain('Careful with that buffer!')
    expect(fake.callsTo('petComment')[0]).toEqual(['pip', 'Edit: csvWriter.ts'])
  })

  it('when a session finishes, a pet runs under its pane and points at it', { timeout: 30_000 }, async () => {
    const { fake } = await renderApp()
    const { key, pane } = await openPane(fake)
    out(fake)
    await expect.element(page.getByTestId('pet')).toBeVisible()
    claudeIs(fake, key, 'running')
    await new Promise((r) => setTimeout(r, 300))
    claudeIs(fake, key, 'idle')
    await expect.poll(() => document.querySelector('[data-testid="pet"] .pet-sprite')?.getAttribute('data-activity'), { timeout: 20_000 }).toBe('point')
    const p = pet().getBoundingClientRect()
    const middle = p.left + p.width / 2
    expect(middle).toBeGreaterThan(pane.left)
    expect(middle).toBeLessThan(pane.right)
  })

  it('every so often the pets put on a scene together', { timeout: 60_000 }, async () => {
    quickBrain({ sceneEveryMs: [1500, 2000] })
    const { fake } = await renderApp()
    out(fake, { pets: [fakePet('a', { size: 44 }), fakePet('b', { size: 44 })] })
    const SCENE = new Set(['catch', 'tennis', 'carry', 'eat', 'drink', 'fish', 'read', 'drive', 'climb', 'parachute'])
    await expect.poll(() => [...document.querySelectorAll('[data-testid="pet"] .pet-sprite')].some((s) => SCENE.has(s.getAttribute('data-activity') ?? '')), { timeout: 50_000 }).toBe(true)
  })
})
