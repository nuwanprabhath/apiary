import { asSessionId } from '@shared/domain/ids'
import { describe, it, expect, vi } from 'vitest'
import type { SessionNode } from '@shared/types'
import { initialLayout } from '../../src/renderer/features/layout/layout'
import type { WorkspaceState } from '../../src/renderer/features/workspace/workspaceReducer'
import { createWorkspaceStore } from '../../src/renderer/features/workspace/workspaceStore'

function session(id: string): SessionNode {
  return {
    kind: 'session', sessionId: asSessionId(id), title: id, cwd: '/repo', cwdExists: true, isLive: false,
    gitBranch: null, lastActiveAtMs: null, messageCount: null, note: null,
  }
}

function empty(): WorkspaceState {
  const layout = initialLayout()
  return {
    layout, activeColumnId: layout.panes[0]?.id ?? null, openSessions: new Map(), resumed: new Set(),
    ptyOverrides: new Map(), pending: new Map(), shellTabs: new Map(), activeTerminal: new Map(),
  }
}

describe('createWorkspaceStore', () => {
  it('applies the reducer on dispatch and keeps the state until the next change', () => {
    const store = createWorkspaceStore(empty())
    const before = store.getState()
    expect(store.getState()).toBe(before)
    store.dispatch({ type: 'session/open', session: session('a'), split: false })
    expect(store.getState()).not.toBe(before)
    expect(store.getState().layout.panes[0].tabs.map((t) => t.key)).toEqual(['a'])
  })

  it('applies dispatches in call order, each to the state the last one left', () => {
    const store = createWorkspaceStore(empty())
    store.dispatch({ type: 'session/open', session: session('a'), split: false })
    store.dispatch({ type: 'session/open', session: session('b'), split: false })
    store.dispatch({ type: 'tab/close', columnId: store.getState().layout.panes[0].id, key: 'a' })
    expect(store.getState().layout.panes[0].tabs.map((t) => t.key)).toEqual(['b'])
  })

  it('tells listeners once per change and not at all for a no-op', () => {
    const store = createWorkspaceStore(empty())
    const listener = vi.fn()
    store.subscribe(listener)
    store.dispatch({ type: 'session/open', session: session('a'), split: false })
    expect(listener).toHaveBeenCalledTimes(1)
    // Focusing the pane that already has focus returns the same state.
    store.dispatch({ type: 'column/focus', columnId: store.getState().layout.panes[0].id })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('stops telling a listener that unsubscribed, and a listener sees the new state', () => {
    const store = createWorkspaceStore(empty())
    const seen: number[] = []
    const off = store.subscribe(() => { seen.push(store.getState().openSessions.size) })
    store.dispatch({ type: 'session/open', session: session('a'), split: false })
    off()
    store.dispatch({ type: 'session/open', session: session('b'), split: false })
    expect(seen).toEqual([1])
  })

  it('keeps dispatch usable detached from the store object (it is handed out as a stable function)', () => {
    const store = createWorkspaceStore(empty())
    const { dispatch } = store
    dispatch({ type: 'session/open', session: session('a'), split: false })
    expect(store.getState().openSessions.has('a')).toBe(true)
  })
})
