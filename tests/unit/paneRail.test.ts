import { must } from './support/must'
import { asSessionId } from '@shared/domain/ids'
import { describe, it, expect } from 'vitest'
import type { SessionNode } from '@shared/types'
import { buildPersistedLayout } from '@shared/layoutReport'
import { isWindowLayoutReport } from '@shared/domain/tabs'
import { newColumn, type Column } from '../../src/renderer/state/columns'
import { applyPreset, railState, tidyLayout, type Layout, type PresetId } from '../../src/renderer/state/layout'
import { railColumns, railedCols } from '../../src/renderer/features/layout/foldedGrid'
import { workspaceReducer, type WorkspaceState } from '../../src/renderer/features/workspace/workspaceReducer'

const pane = (...keys: string[]): Column => newColumn(keys.map((key) => ({ key, view: 'transcript' as const })))
const layoutOf = (preset: PresetId, n: number): Layout =>
  ({ preset, panes: Array.from({ length: n }, (_, i) => pane(`s${String(i)}`)) })

function state(layout: Layout): WorkspaceState {
  return {
    layout, activeColumnId: must(layout.panes[0]).id, openSessions: new Map(), resumed: new Set(),
    ptyOverrides: new Map(), pending: new Map(), shellTabs: new Map(), activeTerminal: new Map(),
  }
}

const rail = (s: WorkspaceState, index: number, on = true): WorkspaceState =>
  workspaceReducer(s, { type: 'layout/rail', columnId: must(s.layout.panes[index]).id, rail: on })

describe('which panes can collapse to a rail', () => {
  it('a full-height pane with a pane beside it can; a pane in a two-row stack cannot', () => {
    const states = (preset: PresetId, n: number): string[] =>
      Array.from({ length: n }, (_, i) => railState(layoutOf(preset, n), i))
    expect(states('single', 1)).toEqual(['none'])
    expect(states('halves-h', 2)).toEqual(['open', 'open'])
    expect(states('thirds-h', 3)).toEqual(['open', 'open', 'open'])
    expect(states('main-right2', 3)).toEqual(['open', 'none', 'none'])
    expect(states('left2-main', 3)).toEqual(['none', 'none', 'open'])
    expect(states('halves-v', 2)).toEqual(['none', 'none'])
    expect(states('top-bottom2', 3)).toEqual(['none', 'none', 'none'])
    expect(states('grid', 4)).toEqual(['none', 'none', 'none', 'none'])
  })

  it('refuses to collapse the last open pane of a row', () => {
    let s = state(layoutOf('thirds-h', 3))
    s = rail(rail(s, 0), 2)
    expect(s.layout.panes.map((p) => p.rail === true)).toEqual([true, false, true])
    expect(railState(s.layout, 1)).toBe('last')
    expect(rail(s, 1).layout).toBe(s.layout)
  })

  it('expands again, and the reducer drops a rail a preset change leaves invalid', () => {
    let s = state(layoutOf('thirds-h', 3))
    s = rail(s, 0)
    expect(railState(s.layout, 0)).toBe('rail')
    expect(must(rail(s, 0, false).layout.panes[0]).rail).toBe(false)
    const next = tidyLayout(applyPreset(s.layout, 'grid'), null)
    expect(next.panes.some((p) => p.rail === true)).toBe(false)
  })

  it('opening a session shown in a railed pane expands it', () => {
    let s = state(layoutOf('halves-h', 2))
    s = rail(s, 1)
    s = workspaceReducer(s, { type: 'tab/activate', columnId: must(s.layout.panes[1]).id, key: 's1' })
    expect(must(s.layout.panes[1]).rail).toBe(false)
  })
})

describe('the grid with rails', () => {
  it('gives a railed column the rail width and leaves the others their weights', () => {
    expect(railColumns('thirds-h', [true, false, false], [1, 2, 1])).toBe('var(--pane-rail-width) 2fr 1fr')
    expect(railColumns('thirds-h', [true, false, true], [1, 2, 1])).toBe('var(--pane-rail-width) 2fr var(--pane-rail-width)')
    expect(railColumns('main-right2', [true, false, false], [1, 1])).toBe('var(--pane-rail-width) 1fr')
    expect(railColumns('thirds-h', [false, false, false], [1, 2, 1])).toBeNull()
    expect([...railedCols('thirds-h', [true, false, true])]).toEqual([0, 2])
  })

  it('keeps the stored column sizes, so expanding restores them exactly', () => {
    const cols = [0.7, 1.6, 0.7]
    railColumns('thirds-h', [true, false, true], cols)
    expect(cols).toEqual([0.7, 1.6, 0.7])
  })
})

describe('a rail persists', () => {
  it('is saved with the layout and read back by the guard', () => {
    const s = rail(state(layoutOf('halves-h', 2)), 0)
    const persisted = buildPersistedLayout(s.layout, new Map(), new Map(), new Map())
    expect(persisted.panes.map((p) => p.rail)).toEqual([true, undefined])
    expect(isWindowLayoutReport({ number: 1, layout: persisted, live: [] })).toBe(true)
    const bad = { ...persisted, panes: [{ ...persisted.panes[0], rail: 'yes' }] }
    expect(isWindowLayoutReport({ number: 1, layout: bad, live: [] })).toBe(false)
  })

  it('does not take a session shown elsewhere', () => {
    const one: SessionNode = {
      kind: 'session', sessionId: asSessionId('s0'), title: 's0', cwd: '/r', cwdExists: true, isLive: false,
      gitBranch: null, lastActiveAtMs: null, messageCount: null, note: null,
    }
    const s = rail(state(layoutOf('halves-h', 2)), 1)
    expect(must(workspaceReducer(s, { type: 'session/open', session: one, split: false }).layout.panes[1]).rail).toBe(true)
  })
})
