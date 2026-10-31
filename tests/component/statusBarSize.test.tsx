import { describe, it, expect } from 'vitest'
import { userEvent } from 'vitest/browser'
import type { StatusBarItem } from '@shared/domain/statusBar'
import { renderApp, unmountApp } from './renderApp'
import { drag, nextFrames, until } from './helpers'
import { mrDeskStatus, regentStatus, withMrDesk, withRegent } from './residentFixtures'

const USAGE: StatusBarItem = {
  pluginId: 'claude-usage', id: 'usage', icon: 'gauge', text: 'Personnel · 5h 29% (12:50 pm) · 7d 65%', title: 'Claude usage',
  tone: 'normal', action: { kind: 'panel' }, detail: [],
}

const bar = (): HTMLElement => document.querySelector<HTMLElement>('[data-testid="status-bar"]')!
const floor = (): HTMLElement => document.querySelector<HTMLElement>('[data-testid="status-bar-floor"]')!
const handle = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-testid="status-bar-resize"]')
const menu = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-testid="status-bar-menu"]')
const height = (): number => bar().getBoundingClientRect().height
const badge = (id: string): HTMLElement => document.querySelector<HTMLElement>(`[data-testid="resident-badge-${id}"]`)!

/** Puts a height in uiState before the app mounts, as an earlier session would have left it. */
const saved = (px: number): void => { localStorage.setItem('apiary.statusBarHeight', String(px)) }

async function mount(px?: number, motion: 'full' | 'reduced' = 'full'): Promise<Awaited<ReturnType<typeof renderApp>>['fake']> {
  if (px !== undefined) saved(px)
  const { fake } = await renderApp({ statusBar: [USAGE], settings: { motion } }, (f) => { withRegent(f); withMrDesk(f) })
  await until(() => document.querySelector('[data-testid="resident-badge-regent"]') !== null)
  return fake
}

async function openMenu(): Promise<void> {
  const r = floor().getBoundingClientRect()
  floor().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 10, clientY: r.y + 5 }))
  await until(() => menu() !== null)
}

const TIERS = [
  { px: 22, tier: 'compact', orb: 20, bee: 16, pot: 16 },
  { px: 34, tier: 'comfortable', orb: 26, bee: 20, pot: 20 },
  { px: 52, tier: 'tall', orb: 38, bee: 28, pot: 30 },
  { px: 58, tier: 'tall', orb: 44, bee: 34, pot: 36 },
  { px: 64, tier: 'tall', orb: 50, bee: 38, pot: 40 },
] as const

describe('the status bar height', () => {
  it.each(TIERS)('$tier: sets data-size and the bar is $px px tall', async ({ px, tier }) => {
    await mount(px)
    await until(() => bar().dataset.size === tier)
    await expect.poll(height).toBe(px)
  })

  it('a working resident grows a compact bar, and never shrinks a tall one', async () => {
    const fake = await mount(22, 'reduced')
    fake.emit('residentsChanged', [regentStatus('working', 'Reading')])
    await expect.poll(height).toBe(28)
    unmountApp()
    const again = await mount(52, 'reduced')
    again.emit('residentsChanged', [regentStatus('working', 'Reading')])
    await until(() => badge('regent').dataset.state === 'working')
    await nextFrames(3)
    expect(height()).toBe(52)
  })

  it('right-click on the floor offers the sizes; Tall makes it 52 px and survives a remount', async () => {
    await mount()
    await openMenu()
    const labels = [...menu()!.querySelectorAll('[role^="menuitem"]')].map((e) => e.textContent)
    expect(labels).toEqual(['Compact', 'Comfortable', 'Tall', 'Resize by dragging'])
    await userEvent.click(menu()!.querySelector<HTMLElement>('[data-testid="context-menu-tall"]')!)
    await expect.poll(height).toBe(52)
    unmountApp()
    await renderApp({ statusBar: [USAGE] })
    await expect.poll(height).toBe(52)
    await openMenu()
    expect(menu()!.textContent).toContain('Reset size')
  })

  it('resize mode: a separator with its aria values, a drag, the clamps, the keys and Escape', async () => {
    await mount()
    expect(handle()).toBeNull()
    await openMenu()
    await userEvent.click(menu()!.querySelector<HTMLElement>('[data-testid="context-menu-resize"]')!)
    await until(() => handle() !== null)
    expect(handle()!.getAttribute('role')).toBe('separator')
    expect(handle()!.getAttribute('aria-valuenow')).toBe('22')
    expect(handle()!.getAttribute('aria-valuemin')).toBe('22')
    expect(handle()!.getAttribute('aria-valuemax')).toBe('64')
    await drag(handle()!, 0, -20)
    await expect.poll(height).toBe(42)
    await drag(handle()!, 0, -200)
    await expect.poll(height).toBe(64)
    await drag(handle()!, 0, 300)
    await expect.poll(height).toBe(22)
    handle()!.focus()
    await userEvent.keyboard('{ArrowUp}')
    await expect.poll(height).toBeGreaterThan(22)
    await userEvent.keyboard('{Escape}')
    await until(() => handle() === null)
  })

  it('tall: a status item and the resident pill each read on two lines; compact, on one', async () => {
    const fake = await mount(52)
    fake.emit('residentsChanged', [regentStatus('working', 'Running mra prompt 1559')])
    const item = document.querySelector<HTMLElement>('[data-testid="status-item-claude-usage-usage"]')!
    await until(() => item.querySelector('.status-item-line2') !== null)
    const l1 = item.querySelector<HTMLElement>('.status-item-line1')!
    const l2 = item.querySelector<HTMLElement>('.status-item-line2')!
    expect(l1.textContent).toBe('Personnel')
    expect(l2.textContent).toBe('5h 29% (12:50 pm) · 7d 65%')
    expect(l2.getBoundingClientRect().top).toBeGreaterThan(l1.getBoundingClientRect().top)
    await until(() => badge('regent').querySelector('.resident-name') !== null)
    const name = badge('regent').querySelector<HTMLElement>('.resident-name')!
    const doing = badge('regent').querySelector<HTMLElement>('.resident-activity')!
    expect(name.textContent).toBe('Regent')
    expect(doing.getBoundingClientRect().top).toBeGreaterThan(name.getBoundingClientRect().top)
    unmountApp()
    await mount(22)
    const flat = document.querySelector<HTMLElement>('[data-testid="status-item-claude-usage-usage"]')!
    expect(flat.querySelector('.status-item-line2')).toBeNull()
    expect(flat.textContent).toBe('Personnel · 5h 29% (12:50 pm) · 7d 65%')
  })

  it('tall: the words are no smaller than compact\'s, and a long activity fits a wide window', async () => {
    const fake = await mount(52)
    fake.emit('residentsChanged', [regentStatus('working', 'Running mra prompt 1559 against main')])
    const item = document.querySelector<HTMLElement>('[data-testid="status-item-claude-usage-usage"]')!
    await until(() => item.querySelector('.status-item-line2') !== null)
    expect(parseFloat(getComputedStyle(item.querySelector('.status-item-line2')!).fontSize)).toBeGreaterThanOrEqual(12)
    await until(() => badge('regent').querySelector('.resident-activity')?.textContent === 'Running mra prompt 1559 against main')
    const doing = badge('regent').querySelector<HTMLElement>('.resident-activity')!
    await expect.poll(() => doing.scrollWidth - doing.clientWidth).toBeLessThanOrEqual(0)
  })

  it('the menu\'s plain actions start their labels where the sizes\' labels do', async () => {
    await mount(52)
    await openMenu()
    const labelLeft = (id: string): number => {
      const el = menu()!.querySelector<HTMLElement>(`[data-testid="context-menu-${id}"]`)!
      const text = [...el.childNodes].find((n) => n.nodeType === Node.TEXT_NODE)!
      const range = document.createRange()
      range.selectNodeContents(text)
      return range.getBoundingClientRect().left
    }
    expect(labelLeft('reset')).toBeCloseTo(labelLeft('tall'), 0)
  })

  it.each(TIERS)('$tier at $px px: the orb is $orb px, its glyph drawn at size on whole pixels, never scaled', async ({ px, orb, bee, pot }) => {
    const fake = await mount(px, 'reduced')
    fake.emit('residentsChanged', [regentStatus('working', 'Reading'), mrDeskStatus('idle', { attention: { count: 2, summary: '2 MRs' } })])
    await until(() => badge('mr-desk').dataset.needs === 'true')
    await nextFrames(3)
    for (const id of ['regent', 'mr-desk']) {
      const orbEl = badge(id).querySelector<HTMLElement>('.resident-orb')!
      const svg = orbEl.querySelector('svg')!.getBoundingClientRect()
      const o = orbEl.getBoundingClientRect()
      expect([o.width, o.height]).toEqual([orb, orb])
      const glyph = id === 'regent' ? bee : pot
      expect([svg.width, svg.height]).toEqual([glyph, glyph])
      for (const v of [o.x, o.y, svg.x, svg.y, svg.width, svg.height]) expect(Number.isInteger(v), `${id} ${String(v)}`).toBe(true)
      for (let el: HTMLElement | null = orbEl; el !== null && el !== bar().parentElement; el = el.parentElement) {
        const cs = getComputedStyle(el)
        expect(cs.zoom === '' || cs.zoom === '1', `zoom on ${el.className}`).toBe(true)
        const m = cs.transform === 'none' ? null : new DOMMatrix(cs.transform)
        expect(m === null || (m.a === 1 && m.d === 1), `scale on ${el.className}`).toBe(true)
      }
    }
  })

  it('the pets\' floor is measured again when the height changes', async () => {
    await mount()
    const before = floor().getBoundingClientRect()
    await openMenu()
    await userEvent.click(menu()!.querySelector<HTMLElement>('[data-testid="context-menu-tall"]')!)
    await expect.poll(() => floor().getBoundingClientRect().height).toBeGreaterThan(before.height)
    expect(floor().getBoundingClientRect().top).toBeLessThan(before.top)
  })
})
