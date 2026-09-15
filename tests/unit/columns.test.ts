import { describe, it, expect } from 'vitest'
import {
  newColumn, openTab, moveTab, moveTabToColumn, setTabView, findColumnWithTab, layoutWeights, openTabAfter, adoptTab,
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

describe('layoutWeights', () => {
  const cols = (...ids: string[]) => ids.map((id) => ({ id, tabs: [], activeKey: null }))

  it('gives every column an equal share when nothing has been dragged', () => {
    const out = layoutWeights(cols('a', 'b'), new Map())
    expect([...out.values()]).toEqual([1, 1])
  })

  it('fills the row when the surviving column was left with a weight below one', () => {
    // The stranded-empty-panel bug: a pair drag leaves 0.6/1.4, the 1.4 column is closed, and
    // flex hands the survivor only 60% of the row because the growth factors no longer reach 1.
    const out = layoutWeights(cols('a'), new Map([['a', 0.6], ['b', 1.4]]))
    expect(out.get('a')).toBe(1)
  })

  it('keeps the ratio the dividers were dragged to', () => {
    const out = layoutWeights(cols('a', 'b'), new Map([['a', 0.5], ['b', 1.5]]))
    expect(out.get('a')).toBe(0.5)
    expect(out.get('b')).toBe(1.5)
    // Always sums to the column count, so there is never free space left over.
    expect((out.get('a') ?? 0) + (out.get('b') ?? 0)).toBe(2)
  })

  it('ignores weights belonging to columns that have gone', () => {
    const out = layoutWeights(cols('a', 'b'), new Map([['a', 1], ['b', 1], ['gone', 50]]))
    expect([...out.values()]).toEqual([1, 1])
  })

  it('never lets a column collapse to nothing, whatever is in the weights', () => {
    const out = layoutWeights(cols('a', 'b'), new Map([['a', 0], ['b', 0]]))
    for (const value of out.values()) expect(value).toBeGreaterThan(0)
  })
})

describe('openTabAfter', () => {
  const column = newColumn([
    { key: 'a', view: 'transcript' },
    { key: 'b', view: 'transcript' },
    { key: 'c', view: 'transcript' },
  ])

  it('puts the new tab directly right of the one it came from', () => {
    // A fork belongs beside its original, not at the far end of the strip.
    expect(openTabAfter(column, 'b-fork', 'b').tabs.map((t) => t.key))
      .toEqual(['a', 'b', 'b-fork', 'c'])
  })

  it('makes the new tab the active one, since it is what was just asked for', () => {
    expect(openTabAfter(column, 'b-fork', 'b').activeKey).toBe('b-fork')
  })

  it('appends when the tab it should follow is not in this column', () => {
    expect(openTabAfter(column, 'z', 'not-here').tabs.map((t) => t.key))
      .toEqual(['a', 'b', 'c', 'z'])
  })

  it('just activates a tab that is already open rather than opening a second copy', () => {
    const same = openTabAfter(column, 'c', 'a')
    expect(same.tabs.map((t) => t.key)).toEqual(['a', 'b', 'c'])
    expect(same.activeKey).toBe('c')
  })
})

describe('adoptTab', () => {
  const columns = [
    newColumn([{ key: 'a', view: 'transcript' }, { key: 'b', view: 'transcript' }]),
    newColumn([{ key: 'c', view: 'transcript' }]),
  ]

  it('takes in a tab from another window at the position it was dropped', () => {
    const next = adoptTab(columns, 'from-elsewhere', columns[0].id, 1)
    expect(next[0].tabs.map((t) => t.key)).toEqual(['a', 'from-elsewhere', 'b'])
    expect(next[0].activeKey).toBe('from-elsewhere')
  })

  it('leaves the other columns alone', () => {
    expect(adoptTab(columns, 'from-elsewhere', columns[0].id, 0)[1]).toBe(columns[1])
  })

  it('clamps a drop position past the end rather than leaving a hole', () => {
    expect(adoptTab(columns, 'z', columns[1].id, 99)[1].tabs.map((t) => t.key)).toEqual(['c', 'z'])
  })

  it('does nothing for a tab this window already has, which is a move and not an adoption', () => {
    // Guards the case where the same key arrives from a drag that never left the window: adopting
    // it would open a second copy of a session that is already here.
    expect(adoptTab(columns, 'c', columns[0].id, 0)).toBe(columns)
  })
})
