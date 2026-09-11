import { describe, it, expect } from 'vitest'
import {
  newColumn, openTab, moveTab, moveTabToColumn, setTabView, findColumnWithTab,
} from '../../src/renderer/state/columns'

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

describe('moveTabToColumn', () => {
  /** Two columns: left holds 'a' and 'b', right holds 'c'. */
  const pair = () => [
    openTab(openTab(newColumn(), 'a'), 'b'),
    openTab(newColumn(), 'c'),
  ]

  it('moves a tab into another column at the position it was dropped', () => {
    const columns = pair()
    const next = moveTabToColumn(columns, 'c', columns[0].id, 0)
    expect(keys(next[0])).toEqual(['c', 'a', 'b'])
  })

  it('takes the tab out of the column it came from, so the session is not open twice', () => {
    const columns = pair()
    const next = moveTabToColumn(columns, 'c', columns[0].id, 2)
    expect(keys(next[0])).toEqual(['a', 'b', 'c'])
    expect(keys(next[1])).toEqual([])
  })

  it('makes the moved tab active where it lands — it is what was just dropped there', () => {
    const columns = pair()
    const next = moveTabToColumn(columns, 'c', columns[0].id, 0)
    expect(next[0].activeKey).toBe('c')
  })

  it('brings the tab\'s view with it, so it arrives showing what it was showing', () => {
    const [left, right] = pair()
    const next = moveTabToColumn([left, setTabView(right, 'c', 'terminal')], 'c', left.id, 0)
    expect(next[0].tabs[0].view).toBe('terminal')
  })

  it('is an ordinary reorder when the tab is already in the target column', () => {
    const columns = pair()
    const next = moveTabToColumn(columns, 'b', columns[0].id, 0)
    expect(keys(next[0])).toEqual(['b', 'a'])
    expect(keys(next[1])).toEqual(['c'])
  })

  it('leaves everything alone when the tab or the column is unknown', () => {
    const columns = pair()
    expect(moveTabToColumn(columns, 'nope', columns[0].id, 0)).toBe(columns)
    expect(moveTabToColumn(columns, 'c', 'no-such-column', 0)).toBe(columns)
  })
})
