import { describe, it, expect } from 'vitest'
import { userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { settled, until } from './helpers'
import { openLayout, panes } from './paneFoldSetup'
import { card, collapse, expandButton, markStatus, openThirds, railButton } from './paneRailSetup'
import { must, take } from './must'

/** Collapsing a full-height pane sideways to a thin rail. */

const width = (el: Element): number => el.getBoundingClientRect().width
const widths = (): string => panes().map((p) => width(p).toFixed(1)).join(' ')

describe('collapsing a pane to a rail', () => {
  it('in three columns, the first and third become rails, the middle takes the width, expanding restores it', async () => {
    await renderApp()
    const [first, middle, third] = take(await openThirds(), 3)
    await settled(widths)
    const before = panes().map(width)

    await collapse(first)
    await collapse(third)
    await settled(widths)
    expect(width(first)).toBeLessThan(60)
    expect(width(third)).toBeLessThan(60)
    expect(width(middle)).toBeGreaterThan(must(before[1]) * 2)
    // The last open pane of the row is refused, and says why.
    expect(railButton(middle)!.getAttribute('aria-disabled')).toBe('true')
    expect(railButton(middle)!.title).toMatch(/stays open/)
    // A real click: the pointer cannot reach an aria-disabled button through the test driver.
    railButton(middle)!.click()
    expect(middle.getAttribute('data-rail')).toBe('false')

    await userEvent.click(expandButton(first)!)
    await userEvent.click(expandButton(third)!)
    await until(() => first.getAttribute('data-rail') === 'false' && third.getAttribute('data-rail') === 'false')
    await settled(widths)
    panes().forEach((p, i) => { expect(Math.abs(width(p) - must(before[i]))).toBeLessThanOrEqual(1) })
  })

  it('a rail entry expands the pane onto that tab', async () => {
    await renderApp()
    const [first] = take(await openThirds(), 1)
    await collapse(first)
    const entries = [...first.querySelectorAll<HTMLElement>('[data-testid="pane-rail-tab"]')]
    expect(entries).toHaveLength(2)
    const other = entries.find((e) => e.getAttribute('data-active') === 'false')!
    await userEvent.click(other)
    await until(() => first.getAttribute('data-rail') === 'false')
    expect(first.getAttribute('data-session-key')).toBe(other.getAttribute('data-key'))
  })

  it('the whole rail glows while a session inside works, and needing the person wins', async () => {
    const { fake } = await renderApp()
    const [first] = take(await openThirds(), 1)
    await collapse(first)
    const keys = [...first.querySelectorAll('[data-testid="pane-rail-tab"]')].map((e) => e.getAttribute('data-key')!)
    await until(() => { markStatus(fake, must(keys[0]), 'running'); return card(first).getAttribute('data-glow') === 'running' })
    await until(() => {
      markStatus(fake, must(keys[0]), 'running')
      markStatus(fake, must(keys[1]), 'waiting')
      return card(first).getAttribute('data-glow') === 'waiting'
    })
    expect(first.getAttribute('data-pane-activity')).toBe('waiting')
  })

  it('only a full-height pane with one beside it offers the button', async () => {
    await renderApp()
    await openLayout('main-right2')
    expect(panes().map((p) => railButton(p) !== null)).toEqual([true, false, false])
  })
})
