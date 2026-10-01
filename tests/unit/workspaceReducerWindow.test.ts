import { asSessionId } from '@shared/domain/ids'
import { describe, it, expect } from 'vitest'
import type { SessionNode } from '@shared/types'
import { initialLayout } from '../../src/renderer/features/layout/layout'
import { workspaceReducer, type WorkspaceState } from '../../src/renderer/features/workspace/workspaceReducer'

function session(id: string): SessionNode {
  return {
    kind: 'session', sessionId: asSessionId(id), title: id, cwd: '/repo', cwdExists: true, isLive: false,
    gitBranch: null, lastActiveAtMs: null, messageCount: null, note: null,
  }
}

function baseState(): WorkspaceState {
  const layout = initialLayout()
  return {
    layout,
    activeColumnId: layout.panes[0]?.id ?? null,
    openSessions: new Map(),
    resumed: new Set(),
    ptyOverrides: new Map(),
    pending: new Map(),
    shellTabs: new Map(),
    activeTerminal: new Map(),
  }
}

/** Two panes, 'a' in the first and 'b' in the second, the second focused. */
function twoPanes(): WorkspaceState {
  let state = baseState()
  state = workspaceReducer(state, { type: 'session/open', session: session('a'), split: false })
  return workspaceReducer(state, { type: 'session/open', session: session('b'), split: true })
}

describe('workspaceReducer: session/open into the focused column', () => {
  it('opens in the active column, not the first, when they differ', () => {
    const state = twoPanes()
    const [first, second] = state.layout.panes
    expect(state.activeColumnId).toBe(second.id)
    const next = workspaceReducer(state, { type: 'session/open', session: session('c'), split: false })
    expect(next.layout.panes.find((p) => p.id === second.id)?.tabs.map((t) => t.key)).toEqual(['b', 'c'])
    expect(next.layout.panes.find((p) => p.id === first.id)?.tabs.map((t) => t.key)).toEqual(['a'])
  })
})

describe('workspaceReducer: window-level actions', () => {
  it('column/focus changes only the active column', () => {
    const state = twoPanes()
    const first = state.layout.panes[0].id
    const next = workspaceReducer(state, { type: 'column/focus', columnId: first })
    expect(next.activeColumnId).toBe(first)
    expect(next.layout).toBe(state.layout)
  })

  it('tab/focus focuses an open key where it is and ignores an unknown one', () => {
    const state = twoPanes()
    const first = state.layout.panes[0].id
    expect(workspaceReducer(state, { type: 'tab/focus', key: 'a' }).activeColumnId).toBe(first)
    expect(workspaceReducer(state, { type: 'tab/focus', key: 'zzz' })).toBe(state)
  })

  it('tab/open opens in the active column without moving focus', () => {
    const state = twoPanes()
    const next = workspaceReducer(state, { type: 'tab/open', key: 'new:x' })
    expect(next.activeColumnId).toBe(state.activeColumnId)
    expect(next.layout.panes[1].tabs.map((t) => t.key)).toEqual(['b', 'new:x'])
  })

  it('tab/showView and tab/closeEverywhere act on every column', () => {
    let state = baseState()
    state = workspaceReducer(state, { type: 'session/open', session: session('a'), split: false })
    const shown = workspaceReducer(state, { type: 'tab/showView', key: 'a', view: 'terminal' })
    expect(shown.layout.panes[0].tabs[0].view).toBe('terminal')
    const closed = workspaceReducer(shown, { type: 'tab/closeEverywhere', key: 'a' })
    expect(closed.layout.panes.flatMap((p) => p.tabs)).toEqual([])
  })

  it('tab/split copies the tab into a new pane and focuses it', () => {
    let state = baseState()
    state = workspaceReducer(state, { type: 'session/open', session: session('a'), split: false })
    const next = workspaceReducer(state, { type: 'tab/split', key: 'a' })
    expect(next.layout.panes).toHaveLength(2)
    expect(next.activeColumnId).toBe(next.layout.panes[1].id)
    expect(workspaceReducer(state, { type: 'tab/split', key: 'nope' })).toBe(state)
  })

  it('layout/place records the session row and focuses the pane it lands in', () => {
    const state = baseState()
    const s = session('p')
    const next = workspaceReducer(state, { type: 'layout/place', key: 'p', preset: 'halves-h', zone: 1, session: s })
    expect(next.openSessions.get('p')).toBe(s)
    expect(next.layout.panes.flatMap((p) => p.tabs.map((t) => t.key))).toContain('p')
  })

  it('openSessions/refresh updates only changed rows and keeps identity otherwise', () => {
    const a = session('a')
    const state = { ...baseState(), openSessions: new Map([['a', a]]) }
    expect(workspaceReducer(state, { type: 'openSessions/refresh', known: new Map([['a', { ...a }]]) })).toBe(state)
    const renamed = { ...a, title: 'new' }
    const next = workspaceReducer(state, { type: 'openSessions/refresh', known: new Map([['a', renamed]]) })
    expect(next.openSessions.get('a')).toBe(renamed)
  })

  it('shellTabs/update and activeTerminal/update apply their updater', () => {
    const state = baseState()
    const s1 = workspaceReducer(state, {
      type: 'shellTabs/update', update: (p) => new Map(p).set('k', [{ id: '1', name: 'T' }]),
    })
    expect(s1.shellTabs.get('k')).toEqual([{ id: '1', name: 'T' }])
    expect(workspaceReducer(s1, { type: 'shellTabs/update', update: (p) => p })).toBe(s1)
    const s2 = workspaceReducer(state, { type: 'activeTerminal/update', update: (p) => new Map(p).set('k', '1') })
    expect(s2.activeTerminal.get('k')).toBe('1')
  })
})
