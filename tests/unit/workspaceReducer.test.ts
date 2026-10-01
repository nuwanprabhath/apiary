import { asSessionId, asPtyId } from '@shared/domain/ids'
import { describe, it, expect } from 'vitest'
import type { ProjectNode, SessionNode } from '@shared/types'
import { initialLayout, type Layout } from '../../src/renderer/features/layout/layout'
import {
  workspaceReducer, openKeysOf, type WorkspaceState,
} from '../../src/renderer/features/workspace/workspaceReducer'

function session(id: string, cwd = '/repo'): SessionNode {
  return {
    kind: 'session', sessionId: asSessionId(id), title: id, cwd, cwdExists: true, isLive: false,
    gitBranch: null, lastActiveAtMs: null, messageCount: null, note: null,
  }
}

function baseState(layout: Layout = initialLayout()): WorkspaceState {
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

describe('workspaceReducer: session/open', () => {
  it('opens a new session into the active column', () => {
    const state = baseState()
    const s = session('a')
    const next = workspaceReducer(state, { type: 'session/open', session: s, split: false })
    expect(next.openSessions.get('a')).toBe(s)
    expect(next.layout.panes[0].tabs.map((t) => t.key)).toEqual(['a'])
    expect(next.layout.panes[0].activeKey).toBe('a')
  })

  it('focuses an already-open session instead of opening it twice', () => {
    let state = baseState()
    const s = session('a')
    state = workspaceReducer(state, { type: 'session/open', session: s, split: false })
    // split it into a second pane, then "open" it again without split — must not duplicate.
    state = workspaceReducer(state, { type: 'session/open', session: session('b'), split: true })
    const before = state.layout.panes.length
    const next = workspaceReducer(state, { type: 'session/open', session: s, split: false })
    expect(next.layout.panes).toHaveLength(before)
    expect(next.layout.panes.flatMap((p) => p.tabs).filter((t) => t.key === 'a')).toHaveLength(1)
  })

  it('splits into a new pane beside the active one', () => {
    let state = baseState()
    // A split with nothing else open would immediately tidy back down to one pane (the vacated
    // original), so exercise it against a window that already has something open — the only case
    // "split" is ever reached from in the real app.
    state = workspaceReducer(state, { type: 'session/open', session: session('first'), split: false })
    const next = workspaceReducer(state, { type: 'session/open', session: session('a'), split: true })
    expect(next.layout.panes.length).toBeGreaterThan(1)
    expect(next.activeColumnId).not.toBe(state.activeColumnId)
  })
})

describe('workspaceReducer: tab ops', () => {
  it('activates, sets view, and closes a tab', () => {
    let state = baseState()
    state = workspaceReducer(state, { type: 'session/open', session: session('a'), split: false })
    const columnId = state.layout.panes[0].id
    state = workspaceReducer(state, { type: 'tab/setView', columnId, key: 'a', view: 'terminal' })
    expect(state.layout.panes[0].tabs[0].view).toBe('terminal')
    state = workspaceReducer(state, { type: 'tab/close', columnId, key: 'a' })
    expect(state.layout.panes[0].tabs).toHaveLength(0)
  })

  it('moves a tab between columns (vacating and tidying the source pane)', () => {
    let state = baseState()
    state = workspaceReducer(state, { type: 'session/open', session: session('a'), split: false })
    state = workspaceReducer(state, { type: 'session/open', session: session('b'), split: true })
    const [, second] = state.layout.panes
    const next = workspaceReducer(state, { type: 'tab/move', key: 'a', toColumnId: second.id, toIndex: 0 })
    // Moving 'a' out of the only tab in its pane empties that pane, which tidyLayout then closes —
    // exactly the "nothing a layout change does closes a tab" rule for the *tab*, but the *pane*
    // does step down, folding both tabs onto the one remaining pane.
    expect(next.layout.panes).toHaveLength(1)
    expect(next.layout.panes[0].tabs.map((t) => t.key).sort()).toEqual(['a', 'b'])
  })

  it('leaves other panes alone when the source pane keeps more than one tab', () => {
    let state = baseState()
    state = workspaceReducer(state, { type: 'session/open', session: session('a'), split: false })
    state = workspaceReducer(state, { type: 'tab/activate', columnId: state.layout.panes[0].id, key: 'a' })
    state = workspaceReducer(state, { type: 'session/open', session: session('extra'), split: false })
    state = workspaceReducer(state, { type: 'session/open', session: session('b'), split: true })
    const [first, second] = state.layout.panes
    const next = workspaceReducer(state, { type: 'tab/move', key: 'a', toColumnId: second.id, toIndex: 0 })
    expect(next.layout.panes.find((p) => p.id === first.id)?.tabs.map((t) => t.key)).toEqual(['extra'])
    expect(next.layout.panes.find((p) => p.id === second.id)?.tabs.some((t) => t.key === 'a')).toBe(true)
  })
})

describe('workspaceReducer: tab/adopt', () => {
  it('adopts a tab dragged from another window, carrying its pty, shells and active shell', () => {
    const state = baseState()
    const next = workspaceReducer(state, {
      type: 'tab/adopt',
      transfer: {
        key: 'sess-1', view: 'terminal', ptyId: 'new:xyz',
        shells: [{ id: 't1', name: 'shell' }], activeShell: 't1',
      },
    })
    expect(next.ptyOverrides.get('sess-1')).toBe('new:xyz')
    expect(next.shellTabs.get('new:xyz')).toEqual([{ id: 't1', name: 'shell' }])
    expect(next.activeTerminal.get('new:xyz')).toBe('t1')
    expect(openKeysOf(next).has('sess-1')).toBe(true)
    expect(next.layout.panes[0].tabs[0].view).toBe('terminal')
  })

  it('does nothing to a tab already open in this window', () => {
    let state = baseState()
    state = workspaceReducer(state, { type: 'session/open', session: session('a'), split: false })
    const next = workspaceReducer(state, {
      type: 'tab/adopt',
      transfer: { key: 'a', view: 'transcript', ptyId: null, shells: [], activeShell: null },
    })
    expect(next.layout.panes[0].tabs).toHaveLength(1)
  })
})

describe('workspaceReducer: pending/add', () => {
  it('registers a pending session and opens it as a tab in the active column', () => {
    const state = baseState()
    const next = workspaceReducer(state, {
      type: 'pending/add',
      info: { ptyId: asPtyId('new:1'), cwd: '/repo', label: 'new session' },
      nodes: [],
    })
    expect(next.pending.get('new:1')?.titleOverride).toBeNull()
    expect(openKeysOf(next).has('new:1')).toBe(true)
  })

  it('opens a fork beside its original, even split across panes', () => {
    let state = baseState()
    state = workspaceReducer(state, { type: 'session/open', session: session('orig'), split: false })
    state = workspaceReducer(state, { type: 'session/open', session: session('elsewhere'), split: true })
    // Switch focus to the second pane so "after" must still find the first.
    const second = state.layout.panes[1].id
    state = { ...state, activeColumnId: second }
    const next = workspaceReducer(state, {
      type: 'pending/add',
      info: { ptyId: asPtyId('new:fork'), cwd: '/repo', label: 'fork' },
      nodes: [],
      titleOverride: 'fork: orig',
      after: 'orig',
    })
    const homeColumn = next.layout.panes.find((p) => p.tabs.some((t) => t.key === 'orig'))!
    expect(homeColumn.tabs.map((t) => t.key)).toEqual(['orig', 'new:fork'])
    expect(next.pending.get('new:fork')?.titleOverride).toBe('fork: orig')
  })

  it('excludes ids already in the tree from a later reconciliation match (via knownSessionIds)', () => {
    const state = baseState()
    const nodes: ProjectNode[] = [{
      kind: 'project', path: '/repo', label: 'repo', branch: null, isWorktree: false,
      children: [], sessions: [session('existing')],
    }]
    const next = workspaceReducer(state, {
      type: 'pending/add', info: { ptyId: asPtyId('new:1'), cwd: '/repo', label: 'x' }, nodes,
    })
    expect(next.pending.get('new:1')?.knownSessionIds.has('existing')).toBe(true)
  })
})

describe('workspaceReducer: pending/title', () => {
  it('records a title override for a still-pending session', () => {
    let state = baseState()
    state = workspaceReducer(state, {
      type: 'pending/add', info: { ptyId: asPtyId('new:1'), cwd: '/repo', label: 'x' }, nodes: [],
    })
    const next = workspaceReducer(state, { type: 'pending/title', ptyId: asPtyId('new:1'), title: 'renamed' })
    expect(next.pending.get('new:1')?.titleOverride).toBe('renamed')
  })

  it('is a no-op for a ptyId with no pending entry', () => {
    const state = baseState()
    const next = workspaceReducer(state, { type: 'pending/title', ptyId: asPtyId('new:1'), title: 'x' })
    expect(next).toBe(state)
  })
})

describe('workspaceReducer: session/follow (reconcile + rekey)', () => {
  it('folds a resolved pending session into the normal bookkeeping, keeping the tab on terminal view', () => {
    let state = baseState()
    state = workspaceReducer(state, {
      type: 'pending/add', info: { ptyId: asPtyId('new:1'), cwd: '/repo', label: 'x' }, nodes: [],
    })
    const found = session('real-1')
    const next = workspaceReducer(state, {
      type: 'session/follow', from: 'new:1', to: found, ptyId: asPtyId('new:1'), titleOverride: null,
    })
    expect(next.ptyOverrides.get('real-1')).toBe('new:1')
    expect(next.resumed.has('real-1')).toBe(true)
    expect(next.openSessions.get('real-1')).toBe(found)
    expect(next.pending.has('new:1')).toBe(false)
    const column = next.layout.panes.find((p) => p.tabs.some((t) => t.key === 'real-1'))!
    expect(column.tabs.find((t) => t.key === 'real-1')?.view).toBe('terminal')
  })

  it('applies a title override typed in while still pending', () => {
    let state = baseState()
    state = workspaceReducer(state, {
      type: 'pending/add', info: { ptyId: asPtyId('new:1'), cwd: '/repo', label: 'x' }, nodes: [],
    })
    const found = session('real-1')
    const next = workspaceReducer(state, {
      type: 'session/follow', from: 'new:1', to: found, ptyId: asPtyId('new:1'), titleOverride: 'my title',
    })
    expect(next.openSessions.get('real-1')?.title).toBe('my title')
  })

  it('rekeys a live tab whose pty moved to another session (e.g. /resume in a new session)', () => {
    let state = baseState()
    state = workspaceReducer(state, { type: 'session/open', session: session('new:1'), split: false })
    state = { ...state, resumed: new Set(['new:1']) }
    const target = session('existing-session')
    const next = workspaceReducer(state, {
      type: 'session/follow', from: 'new:1', to: target, ptyId: asPtyId('new:1'), titleOverride: null,
    })
    expect(next.resumed.has('new:1')).toBe(false)
    expect(next.resumed.has('existing-session')).toBe(true)
    // ptyId equals the tab's key here in the "already correct pty id" sense — no override needed
    // since target.sessionId ('existing-session') differs from ptyId ('new:1'), so one is recorded.
    expect(next.ptyOverrides.get('existing-session')).toBe('new:1')
    const column = next.layout.panes[0]
    expect(column.tabs.map((t) => t.key)).toEqual(['existing-session'])
  })

  it('does not record a ptyOverride when the resolved id already equals the pty id', () => {
    const state = baseState()
    const target = session('same-id')
    const next = workspaceReducer(state, {
      type: 'session/follow', from: 'same-id', to: target, ptyId: asPtyId('same-id'), titleOverride: null,
    })
    expect(next.ptyOverrides.has('same-id')).toBe(false)
  })
})

describe('workspaceReducer: pty/exited', () => {
  it('drops a pending entry whose pty exited before ever resolving', () => {
    let state = baseState()
    state = workspaceReducer(state, {
      type: 'pending/add', info: { ptyId: asPtyId('new:1'), cwd: '/repo', label: 'x' }, nodes: [],
    })
    const next = workspaceReducer(state, { type: 'pty/exited', id: 'new:1' })
    expect(next.pending.has('new:1')).toBe(false)
  })

  it('closes a tab still keyed by its pending pty id, but not a resolved session tab', () => {
    let state = baseState()
    state = workspaceReducer(state, { type: 'session/open', session: session('new:1'), split: false })
    let next = workspaceReducer(state, { type: 'pty/exited', id: 'new:1' })
    expect(next.layout.panes[0].tabs).toHaveLength(0)

    state = baseState()
    state = workspaceReducer(state, { type: 'session/open', session: session('real-1'), split: false })
    next = workspaceReducer(state, { type: 'pty/exited', id: 'real-1' })
    // A real session id is not a "new:" pending id, so its tab survives and reads as stopped.
    expect(next.layout.panes[0].tabs.map((t) => t.key)).toEqual(['real-1'])
  })

  it('drops a shell terminal whose pty exited, and its active-terminal pointer', () => {
    const state: WorkspaceState = {
      ...baseState(),
      shellTabs: new Map([['sess-1', [{ id: 't1', name: 'shell' }, { id: 't2', name: 'shell 2' }]]]),
      activeTerminal: new Map([['sess-1', 't1']]),
    }
    const next = workspaceReducer(state, { type: 'pty/exited', id: 'shell:sess-1:t1' })
    expect(next.shellTabs.get('sess-1')).toEqual([{ id: 't2', name: 'shell 2' }])
    expect(next.activeTerminal.has('sess-1')).toBe(false)
  })

  it('removes the whole shellTabs entry once its last terminal is gone', () => {
    const state: WorkspaceState = {
      ...baseState(),
      shellTabs: new Map([['sess-1', [{ id: 't1', name: 'shell' }]]]),
      activeTerminal: new Map(),
    }
    const next = workspaceReducer(state, { type: 'pty/exited', id: 'shell:sess-1:t1' })
    expect(next.shellTabs.has('sess-1')).toBe(false)
  })
})

describe('workspaceReducer: pty/running', () => {
  it('adds keys reported as running to resumed, without removing any', () => {
    const state = { ...baseState(), resumed: new Set(['a']) }
    const next = workspaceReducer(state, { type: 'pty/running', keys: ['a', 'b', 'c'] })
    expect([...next.resumed].sort()).toEqual(['a', 'b', 'c'])
  })

  it('returns the same state reference when nothing is new', () => {
    const state = { ...baseState(), resumed: new Set(['a']) }
    const next = workspaceReducer(state, { type: 'pty/running', keys: ['a'] })
    expect(next).toBe(state)
  })
})

describe('workspaceReducer: session/removed', () => {
  it('closes every tab for the session and drops it from openSessions', () => {
    let state = baseState()
    state = workspaceReducer(state, { type: 'session/open', session: session('a'), split: false })
    const next = workspaceReducer(state, { type: 'session/removed', sessionId: 'a' })
    expect(next.openSessions.has('a')).toBe(false)
    expect(next.layout.panes.flatMap((p) => p.tabs).some((t) => t.key === 'a')).toBe(false)
  })
})
