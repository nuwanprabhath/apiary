import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import type { StatusBarItem } from '@shared/domain/statusBar'
import { renderApp } from './renderApp'
import { stays, until } from './helpers'
import { message, mrDeskStatus, regentStatus, withMrDesk, withRegent } from './residentFixtures'

const USAGE: StatusBarItem = {
  pluginId: 'claude-usage', id: 'usage', icon: 'gauge', text: '5h 12%', title: 'Claude usage',
  tone: 'normal', action: { kind: 'panel' }, detail: [],
}

const badge = (): HTMLElement | null => document.querySelector('[data-testid="resident-badge-regent"]')
const bar = (): HTMLElement | null => document.querySelector('[data-testid="status-bar"]')
const popup = (): HTMLElement | null => document.querySelector('[data-testid="resident-popup"]')

describe('the resident badge', () => {
  it('renders left of the plugin items', async () => {
    await renderApp({ statusBar: [USAGE] }, (fake) => { withRegent(fake) })
    await until(() => badge() !== null)
    const usage = document.querySelector('[data-testid="status-item-claude-usage-usage"]')!
    const spacer = document.querySelector('[data-testid="status-bar-floor"]')!
    expect(badge()!.getBoundingClientRect().right).toBeLessThanOrEqual(usage.getBoundingClientRect().left)
    expect(badge()!.getBoundingClientRect().left).toBeGreaterThanOrEqual(spacer.getBoundingClientRect().right)
  })

  it('the bar shows when a resident is configured with no plugin items', async () => {
    await renderApp({}, (fake) => { withRegent(fake, { enabled: false }) })
    await until(() => badge() !== null)
    expect(bar()).not.toBeNull()
    expect(badge()!.dataset.state).toBe('asleep')
  })

  it('asleep, idle and working set data-state', async () => {
    const { fake } = await renderApp({}, (f) => { withRegent(f) })
    await until(() => badge()?.dataset.state === 'idle')
    fake.emit('residentsChanged', [regentStatus('working', 'Searching sessions')])
    await until(() => badge()?.dataset.state === 'working')
    expect(badge()!.getAttribute('aria-label')).toBe('Regent: working, Searching sessions')
    fake.emit('residentsChanged', [regentStatus('asleep')])
    await until(() => badge()?.dataset.state === 'asleep')
    expect(badge()!.getAttribute('aria-label')).toBe('Regent: asleep')
  })

  it('working shows the activity text and the bar grows', async () => {
    const { fake } = await renderApp({}, (f) => { withRegent(f) })
    await until(() => badge()?.dataset.state === 'idle')
    const idleHeight = bar()!.getBoundingClientRect().height
    fake.emit('residentsChanged', [regentStatus('working', 'Reading API auth')])
    await expect.element(page.getByTestId('resident-badge-regent')).toHaveTextContent('Reading API auth')
    await until(() => bar()!.getBoundingClientRect().height >= idleHeight + 5)
  })

  it('click toggles the popup', async () => {
    await renderApp({}, (f) => { withRegent(f) })
    await until(() => badge() !== null)
    await userEvent.click(badge()!)
    await until(() => popup() !== null)
    expect(badge()!.getAttribute('aria-expanded')).toBe('true')
    await userEvent.click(badge()!)
    await until(() => popup() === null)
    expect(badge()!.getAttribute('aria-expanded')).toBe('false')
  })

  it('the unread dot appears for a message while closed and clears on open', async () => {
    const { fake } = await renderApp({}, (f) => { withRegent(f) })
    await until(() => badge() !== null)
    const dot = (): Element | null => badge()!.querySelector('.resident-unread')
    expect(dot()).toBeNull()
    fake.emit('residentMessage', { residentId: 'regent', message: message('assistant', 'Digest finished.') })
    await until(() => dot() !== null)
    await userEvent.click(badge()!)
    await until(() => popup() !== null && dot() === null)
  })
})

const mrBadge = (): HTMLElement | null => document.querySelector('[data-testid="resident-badge-mr-desk"]')
const menu = (): HTMLElement | null => document.querySelector('[data-testid="resident-menu"]')
const menuLabels = (): string[] => [...menu()!.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent.trim())

function rightClick(el: HTMLElement): void {
  const r = el.getBoundingClientRect()
  el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 4, clientY: r.top + 4 }))
}

async function clickMenuItem(label: string): Promise<void> {
  const item = [...menu()!.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((i) => i.textContent.trim() === label)!
  await userEvent.click(item)
}

const DESK_ACTIONS = { quickActions: [{ id: 'desk', label: 'Show the desk' }, { id: 'stats', label: 'Show stats' }] }
const tint = (el: Element): string => getComputedStyle(el).getPropertyValue('--resident-tint').trim()

describe('the badge draws its kind and says when it needs you', () => {
  it('the honey-pot appearance draws the pot in the amber palette', async () => {
    await renderApp({}, (f) => { withRegent(f); withMrDesk(f) })
    await until(() => mrBadge() !== null && badge() !== null)
    const orb = mrBadge()!.querySelector<HTMLElement>('.resident-orb')!
    expect(orb.dataset.palette).toBe('amber')
    expect(orb.dataset.animation).toBe('stir')
    expect(orb.querySelector('.pot-dipper')).not.toBeNull()
    expect(orb.querySelector('.bee-wing-l')).toBeNull()
    expect(badge()!.querySelector('.bee-wing-l')).not.toBeNull()
    expect(tint(orb)).not.toBe(tint(badge()!.querySelector('.resident-orb')!))
  })

  it('attention shows the ring, the count and the summary in the pill', async () => {
    await renderApp({}, (f) => { withRegent(f); f.state.residentAttention.set('regent', { count: 3, summary: '3 MRs wait for your review' }) })
    await until(() => badge()?.dataset.needs === 'true')
    expect(badge()!.querySelector('[data-testid="resident-count"]')!.textContent).toBe('3')
    expect(badge()!.querySelector('.resident-activity')!.textContent).toBe('3 MRs wait for your review')
    expect(getComputedStyle(badge()!.querySelector('.resident-activity')!).display).not.toBe('none')
    expect(getComputedStyle(badge()!.querySelector('.resident-badge-orb')!, '::after').animationName).toBe('resident-needs-pulse')
  })

  it('a count of 0 shows "!", and the count replaces the unread dot', async () => {
    const { fake } = await renderApp({}, (f) => { withRegent(f); f.state.residentAttention.set('regent', { count: 0, summary: 'A question for you' }) })
    await until(() => badge()?.dataset.needs === 'true')
    fake.emit('residentMessage', { residentId: 'regent', message: message('assistant', 'Hello') })
    await stays(() => badge()!.querySelector('.resident-unread') === null, 200, 'no unread dot while the count shows')
    expect(badge()!.querySelector('[data-testid="resident-count"]')!.textContent).toBe('!')
  })

  it('permission requests count, say "Waiting for your OK", and working keeps the activity', async () => {
    const { fake } = await renderApp({}, (f) => { withRegent(f) })
    await until(() => badge()?.dataset.state === 'idle')
    const permissions = [{ requestId: 'a', tool: 'Bash', summary: 'Run: glab mr list' }, { requestId: 'b', tool: 'Edit', summary: 'Edit notes.md' }]
    fake.emit('residentsChanged', [{ ...regentStatus('idle'), permissions }])
    await until(() => badge()?.querySelector('[data-testid="resident-count"]')?.textContent === '2')
    expect(badge()!.textContent).toContain('Waiting for your OK')
    fake.emit('residentsChanged', [{ ...regentStatus('working', 'Reading API auth'), permissions }])
    await until(() => badge()!.textContent.includes('Reading API auth'))
    expect(badge()!.dataset.needs).toBe('true')
  })

  it('opening the popup marks the resident seen and clears the attention', async () => {
    const { fake } = await renderApp({}, (f) => { withRegent(f); f.state.residentAttention.set('regent', { count: 2, summary: '2 MRs' }) })
    await until(() => badge()?.dataset.needs === 'true')
    await userEvent.click(badge()!)
    await until(() => fake.callsTo('residentSeen').length === 1)
    await until(() => badge()!.dataset.needs === undefined)
    expect(fake.callsTo('residentSeen')[0]).toEqual(['regent'])
  })
})

describe("the badge's right-click menu", () => {
  it('lists Open chat, the kind actions, Turn off and Settings…', async () => {
    const { fake } = await renderApp({}, (f) => { withMrDesk(f) })
    await until(() => mrBadge() !== null)
    fake.emit('residentsChanged', [mrDeskStatus('idle', DESK_ACTIONS)])
    await until(() => mrBadge()!.dataset.state === 'idle')
    rightClick(mrBadge()!)
    await until(() => menu() !== null)
    expect(menuLabels()).toEqual(['Open chat', 'Show the desk', 'Show stats', 'Turn off', 'Settings…'])
  })

  it('opens from the keyboard with Shift+F10 and the context-menu key', async () => {
    await renderApp({}, (f) => { withRegent(f) })
    await until(() => badge() !== null)
    badge()!.focus()
    await userEvent.keyboard('{Shift>}{F10}{/Shift}')
    await until(() => menu() !== null)
    await userEvent.keyboard('{Escape}')
    await until(() => menu() === null)
    badge()!.focus()
    await userEvent.keyboard('{ContextMenu}')
    await until(() => menu() !== null)
    expect(menuLabels()).toContain('Settings…')
  })

  it('Open chat opens the popup', async () => {
    await renderApp({}, (f) => { withRegent(f) })
    await until(() => badge() !== null)
    rightClick(badge()!)
    await until(() => menu() !== null)
    await clickMenuItem('Open chat')
    await until(() => popup() !== null)
    expect(menu()).toBeNull()
  })

  it('a quick action runs and opens the popup', async () => {
    const { fake } = await renderApp({}, (f) => { withMrDesk(f) })
    fake.override('residentQuickAction', async () => {})
    await until(() => mrBadge() !== null)
    fake.emit('residentsChanged', [mrDeskStatus('idle', DESK_ACTIONS)])
    await until(() => mrBadge()!.dataset.state === 'idle')
    rightClick(mrBadge()!)
    await until(() => menu() !== null)
    await clickMenuItem('Show stats')
    await until(() => fake.callsTo('residentQuickAction').length === 1)
    expect(fake.callsTo('residentQuickAction')[0]).toEqual(['mr-desk', 'stats'])
    await until(() => popup() !== null)
  })

  it('Turn off switches the resident off', async () => {
    const { fake } = await renderApp({}, (f) => { withRegent(f) })
    await until(() => badge() !== null)
    rightClick(badge()!)
    await until(() => menu() !== null)
    await clickMenuItem('Turn off')
    await until(() => fake.state.settings.residents[0]?.enabled === false)
    await until(() => badge()!.dataset.state === 'asleep')
    rightClick(badge()!)
    await until(() => menu() !== null)
    expect(menuLabels()).toContain('Turn on')
  })

  it("Settings… opens Settings at the resident's card and highlights it", async () => {
    await renderApp({}, (f) => { withRegent(f); withMrDesk(f) })
    await until(() => mrBadge() !== null)
    rightClick(mrBadge()!)
    await until(() => menu() !== null)
    await clickMenuItem('Settings…')
    await until(() => document.querySelector('[data-testid="resident-card-mr-desk"]') !== null)
    const card = document.querySelector<HTMLElement>('[data-testid="resident-card-mr-desk"]')!
    await until(() => card.dataset.revealed === 'true')
    await until(() => {
      const r = card.getBoundingClientRect()
      return r.top >= 0 && r.top < window.innerHeight
    })
    await until(() => card.dataset.revealed === 'false', 4000)
    expect(document.querySelector('[data-testid="residents-section"]')).not.toBeNull()
  })
})
