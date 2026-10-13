import { asSessionId } from '@shared/domain/ids'
import { describe, it, expect } from 'vitest'
import type { SessionNode } from '@shared/types'
import { newColumn, type Column } from '../../src/renderer/state/columns'
import { foldState, setFolded, tidyLayout, type Layout } from '../../src/renderer/state/layout'
import { workspaceReducer, type WorkspaceState } from '../../src/renderer/features/workspace/workspaceReducer'
import { buildPersistedLayout } from '@shared/layoutReport'

const pane = (...keys: string[]): Column => newColumn(keys.map((key) => ({ key, view: 'transcript' as const })))

function state(layout: Layout): WorkspaceState {
  return {
    layout, activeColumnId: layout.panes[0].id, openSessions: new Map(), resumed: new Set(),
    ptyOverrides: new Map(), pending: new Map(), shellTabs: new Map(), activeTerminal: new Map(),
  }
}

function session(id: string): SessionNode {
  return {
    kind: 'session', sessionId: asSessionId(id), title: id, cwd: '/repo', cwdExists: true, isLive: false,
    gitBranch: null, lastActiveAtMs: null, messageCount: null, note: null,
  }
}

const fold = (s: WorkspaceState, columnId: string, folded = true): WorkspaceState =>
  workspaceReducer(s, { type: 'layout/fold', columnId, folded })

describe('folding a pane', () => {
  it('folds and unfolds a pane that has a vertical neighbour', () => {
    const s = state({ preset: 'halves-v', panes: [pane('a'), pane('b')] })
    const folded = fold(s, s.layout.panes[0].id)
    expect(folded.layout.panes[0].collapsed).toBe(true)
    expect(fold(folded, s.layout.panes[0].id, false).layout.panes[0].collapsed).toBe(false)
  })

  it('cannot fold a pane with only side-by-side neighbours', () => {
    for (const layout of [
      { preset: 'halves-h', panes: [pane('a'), pane('b')] },
      { preset: 'main-right2', panes: [pane('a'), pane('b'), pane('c')] },
      { preset: 'top-bottom2', panes: [pane('a'), pane('b'), pane('c')] },
    ] satisfies Layout[]) {
      expect(foldState(layout, 0)).toBe('none')
      expect(fold(state(layout), layout.panes[0].id).layout.panes[0].collapsed).toBeUndefined()
    }
  })

  it('folding the last open pane of a stack unfolds the other: the two swap', () => {
    const s = state({ preset: 'halves-v', panes: [pane('a'), pane('b')] })
    const top = fold(s, s.layout.panes[0].id)
    expect(foldState(top.layout, 1)).toBe('open')
    const swapped = fold(top, top.layout.panes[1].id)
    expect(swapped.layout.panes.map((p) => p.collapsed === true)).toEqual([false, true])
  })

  it('folds in one grid column without touching the other', () => {
    const s = state({ preset: 'grid', panes: [pane('a'), pane('b'), pane('c'), pane('d')] })
    const folded = fold(s, s.layout.panes[0].id)
    expect(folded.layout.panes.map((p) => p.collapsed === true)).toEqual([true, false, false, false])
    expect(foldState(folded.layout, 1)).toBe('open')
  })

  it('unfolds a pane that lost its vertical neighbour', () => {
    const layout: Layout = { preset: 'halves-v', panes: [pane('a'), pane()] }
    const folded = { ...layout, panes: [{ ...layout.panes[0], collapsed: true }, layout.panes[1]] }
    const tidied = tidyLayout(folded, null)
    expect(tidied.preset).toBe('single')
    expect(tidied.panes[0].collapsed).toBe(false)
  })

  it('unfolds when a layout change leaves the pane beside the others', () => {
    const s = state({ preset: 'halves-v', panes: [pane('a'), pane('b')] })
    const folded = fold(s, s.layout.panes[0].id)
    const applied = workspaceReducer(folded, { type: 'layout/apply', preset: 'halves-h' })
    expect(applied.layout.panes.some((p) => p.collapsed === true)).toBe(false)
  })

  it('unfolds the pane a tab is activated in', () => {
    const s = state({ preset: 'halves-v', panes: [pane('a', 'x'), pane('b')] })
    const folded = fold(s, s.layout.panes[0].id)
    const next = workspaceReducer(folded, { type: 'tab/activate', columnId: s.layout.panes[0].id, key: 'x' })
    expect(next.layout.panes[0].collapsed).toBe(false)
    expect(next.layout.panes[0].activeKey).toBe('x')
  })

  it('unfolds the pane a session is opened into', () => {
    const s = state({ preset: 'halves-v', panes: [pane('a'), pane('b')] })
    const folded = fold(s, s.layout.panes[0].id)
    const next = workspaceReducer(folded, { type: 'session/open', session: session('new'), split: false })
    expect(next.layout.panes[0].activeKey).toBe('new')
    expect(next.layout.panes[0].collapsed).toBe(false)
  })

  it('stays folded when the session already in front is reopened (launch restore)', () => {
    const s = state({ preset: 'halves-v', panes: [pane('a'), pane('b')] })
    const folded = fold(s, s.layout.panes[0].id)
    const next = workspaceReducer(folded, { type: 'session/open', session: session('a'), split: false })
    expect(next.layout.panes[0].collapsed).toBe(true)
  })

  it('leaves a folded pane folded when something opens elsewhere', () => {
    const s = state({ preset: 'halves-v', panes: [pane('a'), pane('b')] })
    const folded = { ...fold(s, s.layout.panes[0].id), activeColumnId: s.layout.panes[1].id }
    const next = workspaceReducer(folded, { type: 'session/open', session: session('new'), split: false })
    expect(next.layout.panes[0].collapsed).toBe(true)
  })

  it('is remembered with the window layout', () => {
    const layout: Layout = { preset: 'halves-v', panes: [pane('a'), pane('b')] }
    const top = setFolded(layout, layout.panes[0].id, true)
    const persisted = buildPersistedLayout(top, new Map(), new Map(), new Map())
    expect(persisted.panes.map((p) => p.collapsed)).toEqual([true, undefined])
  })
})
