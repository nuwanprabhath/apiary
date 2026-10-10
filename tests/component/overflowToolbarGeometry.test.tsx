import type { JSX } from 'react'
import { describe, it, expect } from 'vitest'
import { mountUi } from './mountUi'
import { Toolbar, type ToolbarButtonSpec } from '../../src/renderer/features/pane/Toolbar'
import {
  ArrowDownIcon, ArrowUpIcon, BranchIcon, CopyIcon, ListIcon, PlusIcon,
} from '../../src/renderer/ui/icons'
import { ChevronIcon } from '../../src/renderer/ui/icons/ChevronIcon'
import { until } from './helpers'

const spec = (id: string, icon: ToolbarButtonSpec['icon'], extra: Partial<ToolbarButtonSpec> = {}): ToolbarButtonSpec => ({
  id, icon, title: id, testId: `tb-${id}`, onClick: () => {}, ...extra,
})

const left = [
  spec('toggle', <ChevronIcon expanded />, { label: 'Shell', labelMode: 'collapse' }),
  spec('branch', <BranchIcon />, { label: 'feature/a-really-long-branch-name-for-testing', labelMode: 'shrink', badge: '↓141' }),
]
// Overflow order: copy, push, pull, then the terminal list; new terminal stays longest.
const right = [
  spec('pull', <ArrowDownIcon />, { priority: 4 }),
  spec('push', <ArrowUpIcon />, { priority: 5 }),
  spec('copy', <CopyIcon />, { priority: 7 }),
  spec('new', <PlusIcon />, { priority: 1 }),
  spec('list', <ListIcon />, { priority: 2 }),
]
const ids = [...left, ...right].map((s) => s.id)

const shownIds = (): string[] => ids.filter((id) => document.querySelector(`.overflow-toolbar [data-item-id="${id}"]`))
const rowBox = (): DOMRect => document.querySelector<HTMLElement>('[role="toolbar"]')!.getBoundingClientRect()
const more = (): HTMLButtonElement | null => document.querySelector<HTMLButtonElement>('[data-testid="overflow-menu-button"]')

function expectAllInside(): void {
  const box = rowBox()
  for (const el of document.querySelectorAll<HTMLElement>('.overflow-toolbar > [data-item-id], .overflow-toolbar > [data-testid="overflow-menu-button"]')) {
    const r = el.getBoundingClientRect()
    expect(r.width).toBeGreaterThan(0)
    expect(r.left).toBeGreaterThanOrEqual(box.left - 0.5)
    expect(r.right).toBeLessThanOrEqual(box.right + 0.5)
  }
}

async function menuIds(): Promise<string[]> {
  const button = more()
  if (!button) return []
  button.click()
  await until(() => document.querySelector('[data-testid="overflow-menu"]') !== null)
  const found = ids.filter((id) => document.querySelector(`[data-testid="overflow-tb-${id}"]`))
  button.click()
  await until(() => document.querySelector('[data-testid="overflow-menu"]') === null)
  return found
}

const labelOf = (id: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`.overflow-toolbar [data-item-id="${id}"] .toolbar-button-label`)
const visible = (el: HTMLElement | null): boolean => el !== null && el.getBoundingClientRect().width > 0

function host(width: number): JSX.Element {
  return <div style={{ width: `${width}px` }}><Toolbar left={left} right={right} /></div>
}

describe('pane Toolbar overflow geometry', () => {
  it('moves buttons whole in priority order, keeps the » last and the row one line, and restores on widening', async () => {
    const m = await mountUi(host(900))
    await until(() => shownIds().length === ids.length)
    expect(more()).toBeNull()
    expectAllInside()
    const height = rowBox().height

    await m.rerender(host(330))
    await until(() => more() !== null)
    expectAllInside()
    const shown = shownIds()
    expect(shown).toContain('new')
    expect(shown).not.toContain('copy') // copy goes first
    expect(shown).toContain('toggle')
    expect(shown).toContain('branch') // pinned: never in the menu
    expect([...shown, ...(await menuIds())].sort()).toEqual([...ids].sort())
    // The » is the last item in the row and on its line.
    const last = [...document.querySelectorAll('.overflow-toolbar > button')].filter((b) => !b.closest('.overflow-toolbar-measure')).at(-1)
    expect(last).toBe(more())
    expect(rowBox().height).toBe(height)
    expect(Math.abs(more()!.getBoundingClientRect().top - document.querySelector('[data-item-id="toggle"]')!.getBoundingClientRect().top)).toBeLessThan(1)

    await m.rerender(host(160))
    await until(() => !visible(labelOf('branch')))
    expectAllInside()
    expect(rowBox().height).toBe(height)
    expect(shownIds()).toContain('branch')
    expect([...shownIds(), ...(await menuIds())].sort()).toEqual([...ids].sort())

    await m.rerender(host(900))
    await until(() => shownIds().length === ids.length)
    expect(more()).toBeNull()
    expect(visible(labelOf('toggle'))).toBe(true)
    expectAllInside()
  })

  it('hides the Shell word whole, never cut, only when the branch name is already gone', async () => {
    const m = await mountUi(host(900))
    await until(() => shownIds().length === ids.length)
    await m.rerender(host(160))
    await until(() => !visible(labelOf('toggle')))
    // Whole or absent: no half-width label.
    expect(labelOf('toggle')?.getBoundingClientRect().width ?? 0).toBe(0)
    expect(visible(labelOf('branch'))).toBe(false)
    expectAllInside()
  })

  it('opens the overflow menu outside the row without changing the row height', async () => {
    await mountUi(host(330))
    await until(() => more() !== null)
    const before = rowBox()
    more()!.click()
    await until(() => document.querySelector('[data-testid="overflow-menu"]') !== null)
    const menu = document.querySelector<HTMLElement>('[data-testid="overflow-menu"]')!
    expect(menu.closest('[role="toolbar"]')).toBeNull()
    expect(getComputedStyle(menu).listStyleType).toBe('none')
    const after = rowBox()
    const box = menu.getBoundingClientRect()
    expect(after.height).toBe(before.height)
    expect(box.bottom <= after.top || box.top >= after.bottom).toBe(true)
    // Right edge on the » button's right edge (unless clamped to the window).
    expect(Math.abs(box.right - more()!.getBoundingClientRect().right)).toBeLessThan(2)
  })
})
