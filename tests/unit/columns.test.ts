import { describe, it, expect } from 'vitest'
import { newColumn, openTab, moveTab, findColumnWithTab } from '../../src/renderer/state/columns'

const keys = (column: { tabs: { key: string }[] }): string[] => column.tabs.map((t) => t.key)

describe('findColumnWithTab', () => {
  it('finds the column a session is already open in, so it is focused rather than opened twice', () => {
    const left = openTab(newColumn(), 'a')
    const right = openTab(openTab(newColumn(), 'b'), 'c')
    expect(findColumnWithTab([left, right], 'c')?.id).toBe(right.id)
    expect(findColumnWithTab([left, right], 'a')?.id).toBe(left.id)
  })

  it('returns null for a session that is not open anywhere', () => {
    expect(findColumnWithTab([openTab(newColumn(), 'a')], 'zzz')).toBeNull()
  })
})

describe('moveTab', () => {
  const three = (): ReturnType<typeof newColumn> =>
    openTab(openTab(openTab(newColumn(), 'a'), 'b'), 'c')

  it('moves a tab to the front', () => {
    expect(keys(moveTab(three(), 'c', 0))).toEqual(['c', 'a', 'b'])
  })

  it('moves a tab to the end', () => {
    expect(keys(moveTab(three(), 'a', 2))).toEqual(['b', 'c', 'a'])
  })

  it('reads the target index against the list without the dragged tab, so dragging rightwards is not off by one', () => {
    // 'a' dropped onto the position 'b' occupies: 'b' is at index 1 with 'a' still in the list, but
    // at index 0 once 'a' is lifted out — and landing before 'c' is what dropping on 'b' means.
    expect(keys(moveTab(three(), 'a', 1))).toEqual(['b', 'a', 'c'])
  })

  it('clamps an out-of-range index rather than dropping the tab', () => {
    expect(keys(moveTab(three(), 'a', 99))).toEqual(['b', 'c', 'a'])
    expect(keys(moveTab(three(), 'c', -5))).toEqual(['c', 'a', 'b'])
  })

  it('leaves the active tab and the column alone when the key is not there', () => {
    const column = three()
    expect(moveTab(column, 'nope', 0)).toBe(column)
  })

  it('keeps which tab is active while reordering', () => {
    const column = three() // 'c' was opened last, so it is active
    expect(moveTab(column, 'a', 2).activeKey).toBe('c')
  })
})
