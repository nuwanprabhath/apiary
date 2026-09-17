import { describe, it, expect } from 'vitest'
import { newColumn, type Column } from '../../src/renderer/state/columns'
import {
  PRESETS, capacity, applyPreset, placeInZone, initialLayout, type Layout, type PresetId,
  closePane, tidyLayout, openBeside, stepDown, stepUp,
  dragTracks, trackTemplate, boundaryAt, defaultTracks,
} from '../../src/renderer/state/layout'

const pane = (...keys: string[]): Column =>
  newColumn(keys.map((key) => ({ key, view: 'transcript' as const })))
const keysOf = (layout: Layout): string[][] => layout.panes.map((p) => p.tabs.map((t) => t.key))
const allKeys = (layout: Layout): string[] => layout.panes.flatMap((p) => p.tabs.map((t) => t.key)).sort()

describe('presets', () => {
  it('offers the eight layouts, each holding between one and four panes', () => {
    expect(PRESETS.map((p) => p.id)).toEqual([
      'single', 'halves-h', 'halves-v', 'thirds-h', 'main-right2', 'left2-main', 'top-bottom2', 'grid',
    ])
    const caps = Object.fromEntries(PRESETS.map((p) => [p.id, capacity(p.id)]))
    expect(caps).toEqual({
      single: 1, 'halves-h': 2, 'halves-v': 2, 'thirds-h': 3,
      'main-right2': 3, 'left2-main': 3, 'top-bottom2': 3, grid: 4,
    })
  })

  it('names every zone of a preset exactly once in its grid areas', () => {
    for (const p of PRESETS) {
      const names = new Set(p.areas.join(' ').split(/\s+/))
      expect([...names].sort()).toEqual(
        Array.from({ length: capacity(p.id) }, (_, i) => `z${String(i + 1)}`),
      )
      expect(p.areas).toHaveLength(p.rows)
      for (const row of p.areas) expect(row.split(/\s+/)).toHaveLength(p.cols)
    }
  })

  it('starts a window as one pane', () => {
    const layout = initialLayout()
    expect(layout.preset).toBe('single')
    expect(layout.panes).toHaveLength(1)
    expect(layout.panes[0].placeholder).not.toBe(true)
  })
})

describe('applying a layout without moving anything', () => {
  it('keeps the panes in order and leaves the extra zones waiting to be filled', () => {
    const layout: Layout = { preset: 'halves-h', panes: [pane('a'), pane('b')] }
    const next = applyPreset(layout, 'grid')
    expect(next.preset).toBe('grid')
    expect(keysOf(next)).toEqual([['a'], ['b'], [], []])
    expect(next.panes.slice(2).every((p) => p.placeholder === true)).toBe(true)
    // The panes that were there are the same panes, so their terminals are not remounted.
    expect(next.panes[0].id).toBe(layout.panes[0].id)
  })

  it('folds the tabs of panes that no longer fit into the last one, closing nothing', () => {
    const layout: Layout = { preset: 'thirds-h', panes: [pane('a'), pane('b', 'c'), pane('d')] }
    const next = applyPreset(layout, 'halves-h')
    expect(keysOf(next)).toEqual([['a'], ['b', 'c', 'd']])
    // The pane taking them in keeps showing what it was showing.
    expect(next.panes[1].activeKey).toBe('b')
  })

  it('drops waiting zones before counting what fits', () => {
    const layout: Layout = { preset: 'grid', panes: [pane('a'), { ...newColumn(), placeholder: true }, pane('b'), { ...newColumn(), placeholder: true }] }
    expect(keysOf(applyPreset(layout, 'halves-v'))).toEqual([['a'], ['b']])
  })

  it('an empty window stays one ordinary empty pane when set to single', () => {
    const next = applyPreset(initialLayout(), 'single')
    expect(next.panes).toHaveLength(1)
    expect(next.panes[0].placeholder).not.toBe(true)
  })

  it('reuses a surviving placeholder\'s id instead of minting a new one for a leftover zone', () => {
    // A focused placeholder (PaneFiller open, search text typed into it) must not remount when a
    // reflow leaves it waiting again — remounting loses the search text and drops it as the active
    // pane. Reusing its id by order is what keeps it the same pane across the reflow.
    const layout: Layout = { preset: 'halves-h', panes: [pane('a'), { ...newColumn(), placeholder: true }] }
    const waitingId = layout.panes[1].id
    const next = applyPreset(layout, 'grid')
    expect(keysOf(next)).toEqual([['a'], [], [], []])
    expect(next.panes.some((p) => p.id === waitingId && p.placeholder === true)).toBe(true)
  })
})

describe('placing a session in a zone', () => {
  it('opens a session that is not open yet in the chosen zone, and the others fill around it', () => {
    const layout: Layout = { preset: 'halves-h', panes: [pane('a'), pane('b')] }
    const { layout: next, paneId } = placeInZone(layout, 'main-right2', 0, 'new')
    expect(keysOf(next)).toEqual([['new'], ['a'], ['b']])
    expect(next.panes[0].id).toBe(paneId)
    expect(next.panes[0].activeKey).toBe('new')
  })

  it('moves a session that is already open rather than opening it twice', () => {
    const layout: Layout = { preset: 'halves-h', panes: [pane('a', 'b'), pane('c')] }
    const { layout: next } = placeInZone(layout, 'halves-h', 1, 'b')
    // b is out of the first pane and in zone 2; c had no zone left, so it joined the last pane,
    // behind b — nothing closed, and b is still the one in front.
    expect(keysOf(next)).toEqual([['a'], ['b', 'c']])
    expect(next.panes[1].activeKey).toBe('b')
  })

  it('keeps the pane itself when the session was the only tab in it', () => {
    const layout: Layout = { preset: 'halves-h', panes: [pane('a'), pane('b')] }
    const { layout: next, paneId } = placeInZone(layout, 'halves-h', 0, 'b')
    expect(paneId).toBe(layout.panes[1].id)
    expect(keysOf(next)).toEqual([['b'], ['a']])
  })

  it('drops a pane the move emptied before filling, so it does not take a zone', () => {
    const layout: Layout = { preset: 'thirds-h', panes: [pane('a'), pane('b'), pane('c')] }
    const { layout: next } = placeInZone(layout, 'grid', 3, 'b')
    expect(keysOf(next)).toEqual([['a'], ['c'], [], ['b']])
    expect(next.panes[2].placeholder).toBe(true)
  })

  it('placing a session where it already is changes only the layout', () => {
    const layout: Layout = { preset: 'halves-h', panes: [pane('a'), pane('b')] }
    const { layout: next } = placeInZone(layout, 'halves-v', 1, 'b')
    expect(next.preset).toBe('halves-v')
    expect(keysOf(next)).toEqual([['a'], ['b']])
  })

  it('keeps the view a moved tab was on', () => {
    const running = newColumn([{ key: 'r', view: 'terminal' }, { key: 'x', view: 'transcript' }])
    const { layout: next } = placeInZone({ preset: 'single', panes: [running] }, 'halves-h', 1, 'r')
    expect(next.panes[1].tabs[0]).toEqual({ key: 'r', view: 'terminal' })
  })

  it('in a single pane, everything else joins the placed session rather than closing', () => {
    const layout: Layout = { preset: 'halves-h', panes: [pane('a'), pane('b')] }
    const { layout: next } = placeInZone(layout, 'single', 0, 'b')
    expect(keysOf(next)).toEqual([['b', 'a']])
    expect(next.panes[0].activeKey).toBe('b')
  })

  it('clamps a zone past the end of the preset', () => {
    const { layout: next } = placeInZone({ preset: 'single', panes: [pane('a')] }, 'halves-v', 9, 'n')
    expect(keysOf(next)).toEqual([['a'], ['n']])
  })

  it('placing from a specific pane moves that pane when the key is open in two at once', () => {
    // A session split into two panes, both showing it alone: halves-h [col-1:A][col-2:A]. Placing
    // from the *second* pane's tab must move that pane, not the first one the key happens to be
    // found in — otherwise the wrong pane moves, the wrong one ends up focused, and the copy that
    // should have stayed behind is left forgotten instead.
    const layout: Layout = { preset: 'halves-h', panes: [pane('a'), pane('a')] }
    const fromPaneId = layout.panes[1].id
    const { layout: next, paneId } = placeInZone(layout, 'grid', 3, 'a', fromPaneId)
    expect(paneId).toBe(fromPaneId)
    // The moved pane (originally col-2) is now in zone 4; the copy (col-1) stayed at zone 1.
    expect(next.panes[3].id).toBe(fromPaneId)
    expect(next.panes[0].id).toBe(layout.panes[0].id)
    expect(keysOf(next)).toEqual([['a'], [], [], ['a']])
  })

  it('never loses a tab, whatever is placed where', () => {
    const presets: PresetId[] = PRESETS.map((p) => p.id)
    const base: Layout = { preset: 'grid', panes: [pane('a', 'b'), pane('c'), pane('d'), pane('e', 'f')] }
    for (const preset of presets) {
      for (let zone = 0; zone < capacity(preset); zone++) {
        for (const key of ['a', 'c', 'f', 'z']) {
          const { layout: next } = placeInZone(base, preset, zone, key)
          const expected = [...new Set(['a', 'b', 'c', 'd', 'e', 'f', key])].sort()
          expect(allKeys(next)).toEqual(expected)
          expect(next.panes.length).toBeLessThanOrEqual(capacity(preset))
        }
      }
    }
  })
})

describe('closing a pane', () => {
  it('steps each layout down to the next smaller one', () => {
    expect(stepDown('grid')).toBe('main-right2')
    expect(stepDown('main-right2')).toBe('halves-h')
    expect(stepDown('left2-main')).toBe('halves-h')
    expect(stepDown('thirds-h')).toBe('halves-h')
    expect(stepDown('top-bottom2')).toBe('halves-v')
    expect(stepDown('halves-h')).toBe('single')
    expect(stepDown('halves-v')).toBe('single')
    expect(stepDown('single')).toBe('single')
  })

  it('reflows the rest, with the pane being worked in taking the large zone', () => {
    const layout: Layout = { preset: 'grid', panes: [pane('a'), pane('b'), pane('c'), pane('d')] }
    const next = closePane(layout, layout.panes[0].id, layout.panes[2].id)
    expect(next.preset).toBe('main-right2')
    expect(keysOf(next)).toEqual([['c'], ['b'], ['d']])
  })

  it('keeps the existing order when the pane being worked in is the one closed', () => {
    const layout: Layout = { preset: 'thirds-h', panes: [pane('a'), pane('b'), pane('c')] }
    const next = closePane(layout, layout.panes[1].id, layout.panes[1].id)
    expect(next.preset).toBe('halves-h')
    expect(keysOf(next)).toEqual([['a'], ['c']])
  })

  it('never closes the last pane', () => {
    const layout: Layout = { preset: 'single', panes: [pane('a')] }
    const next = closePane(layout, layout.panes[0].id, null)
    expect(next.panes).toHaveLength(1)
  })

  it('keeps the ids of the panes that stay, so their terminals are not remounted', () => {
    const layout: Layout = { preset: 'halves-h', panes: [pane('a'), pane('b')] }
    const next = closePane(layout, layout.panes[0].id, null)
    expect(next.panes[0].id).toBe(layout.panes[1].id)
  })

  it('reuses a surviving placeholder\'s id when a pane closes and the layout steps down', () => {
    const waitingPane = { ...newColumn(), placeholder: true }
    const layout: Layout = { preset: 'grid', panes: [pane('a'), pane('b'), waitingPane, pane('c')] }
    const next = closePane(layout, layout.panes[0].id, layout.panes[3].id)
    expect(next.preset).toBe('main-right2')
    expect(next.panes.some((p) => p.id === waitingPane.id && p.placeholder === true)).toBe(true)
  })
})

describe('tidying after any change', () => {
  it('closes a pane whose last tab went away', () => {
    const layout: Layout = { preset: 'halves-h', panes: [pane('a'), newColumn()] }
    const next = tidyLayout(layout, null)
    expect(next.preset).toBe('single')
    expect(keysOf(next)).toEqual([['a']])
  })

  it('keeps a pane that is waiting to be filled', () => {
    const layout: Layout = { preset: 'halves-h', panes: [pane('a'), { ...newColumn(), placeholder: true }] }
    expect(tidyLayout(layout, null)).toEqual(layout)
  })

  it('stops calling a pane waiting once something is opened in it', () => {
    const filled = { ...pane('x'), placeholder: true }
    const next = tidyLayout({ preset: 'halves-h', panes: [pane('a'), filled] }, null)
    expect(next.panes[1].placeholder).toBe(false)
  })

  it('keeps one empty ordinary pane when everything is closed', () => {
    const layout: Layout = { preset: 'halves-h', panes: [newColumn(), newColumn()] }
    const next = tidyLayout(layout, null)
    expect(next.preset).toBe('single')
    expect(next.panes).toHaveLength(1)
    expect(next.panes[0].placeholder).not.toBe(true)
  })

  it('a lone waiting pane in single becomes an ordinary empty one', () => {
    const next = tidyLayout({ preset: 'single', panes: [{ ...newColumn(), placeholder: true }] }, null)
    expect(next.panes[0].placeholder).not.toBe(true)
  })

  it('grows the layout if something added more panes than it holds', () => {
    const layout: Layout = { preset: 'halves-h', panes: [pane('a'), pane('b'), pane('c')] }
    const next = tidyLayout(layout, null)
    expect(next.panes.length).toBeLessThanOrEqual(capacity(next.preset))
    expect(allKeys(next)).toEqual(['a', 'b', 'c'])
  })

  it('returns the same object when nothing needs tidying', () => {
    const layout: Layout = { preset: 'halves-h', panes: [pane('a'), pane('b')] }
    expect(tidyLayout(layout, null)).toBe(layout)
  })
})

describe('opening a session to the side', () => {
  it('steps each layout up, keeping rows as rows', () => {
    expect(stepUp('single')).toBe('halves-h')
    expect(stepUp('halves-h')).toBe('main-right2')
    expect(stepUp('halves-v')).toBe('top-bottom2')
    expect(stepUp('main-right2')).toBe('grid')
    expect(stepUp('left2-main')).toBe('grid')
    expect(stepUp('thirds-h')).toBe('grid')
    expect(stepUp('top-bottom2')).toBe('grid')
    expect(stepUp('grid')).toBe('grid')
  })

  it('adds a pane by growing the layout', () => {
    const layout: Layout = { preset: 'single', panes: [pane('a')] }
    const { layout: next, paneId } = openBeside(layout, layout.panes[0].id, { key: 'b', view: 'transcript' })
    expect(next.preset).toBe('halves-h')
    expect(keysOf(next)).toEqual([['a'], ['b']])
    expect(next.panes[1].id).toBe(paneId)
  })

  it('fills a waiting zone before growing', () => {
    const layout: Layout = { preset: 'grid', panes: [pane('a'), pane('b'), { ...newColumn(), placeholder: true }, pane('c')] }
    const { layout: next } = openBeside(layout, layout.panes[0].id, { key: 'n', view: 'transcript' })
    expect(next.preset).toBe('grid')
    expect(keysOf(next)).toEqual([['a'], ['b'], ['n'], ['c']])
    expect(next.panes[2].placeholder).toBe(false)
  })

  it('with four panes, opens as a tab in the pane after the active one, wrapping round', () => {
    const layout: Layout = { preset: 'grid', panes: [pane('a'), pane('b'), pane('c'), pane('d')] }
    const { layout: next, paneId } = openBeside(layout, layout.panes[3].id, { key: 'n', view: 'transcript' })
    expect(next.preset).toBe('grid')
    expect(keysOf(next)[0]).toEqual(['a', 'n'])
    expect(next.panes[0].activeKey).toBe('n')
    expect(paneId).toBe(layout.panes[0].id)
  })

  it('never makes a fifth pane', () => {
    let layout: Layout = initialLayout()
    for (const key of ['a', 'b', 'c', 'd', 'e', 'f']) {
      layout = openBeside(layout, layout.panes[0].id, { key, view: 'transcript' }).layout
    }
    expect(layout.panes.length).toBeLessThanOrEqual(4)
  })
})

describe('dragging a divider', () => {
  it('moves only the boundary dragged, keeping the pair\'s combined size', () => {
    const next = dragTracks([1, 1, 1], 0, 0.5, 0)
    expect(next[2]).toBe(1)
    expect(next[0] + next[1]).toBeCloseTo(2)
    expect(boundaryAt(next, 0)).toBeCloseTo(0.5)
  })

  it('does not let either side go below its floor', () => {
    const next = dragTracks([1, 1], 0, 0.01, 0.2)
    expect(boundaryAt(next, 0)).toBeCloseTo(0.2)
    const other = dragTracks([1, 1], 0, 0.99, 0.2)
    expect(boundaryAt(other, 0)).toBeCloseTo(0.8)
  })

  it('works on a boundary that is not the first', () => {
    const next = dragTracks([1, 1, 1], 1, 0.9, 0.1)
    expect(next[0]).toBe(1)
    expect(boundaryAt(next, 1)).toBeCloseTo(0.9)
  })

  it('ignores a boundary that does not exist', () => {
    expect(dragTracks([1, 1], 3, 0.5, 0)).toEqual([1, 1])
  })

  it('writes tracks as fractions of the space', () => {
    expect(trackTemplate([1.5, 0.5])).toBe('1.5fr 0.5fr')
  })

  it('starts every preset with equal tracks', () => {
    expect(defaultTracks('grid')).toEqual({ cols: [1, 1], rows: [1, 1] })
    expect(defaultTracks('thirds-h')).toEqual({ cols: [1, 1, 1], rows: [1] })
  })
})
