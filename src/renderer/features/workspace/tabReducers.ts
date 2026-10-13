/** The reducer's tab and layout transitions: what opening, moving, splitting and arranging do. */
import { openTab, closeTab, setTabView, moveTabToColumn, adoptTab, findColumnWithTab } from '../../state/columns'
import { tidyLayout, openBeside, placeInZone, applyPreset, closePane, swapPanes, setFolded } from '../../state/layout'
import { targetColumnId, updateColumns } from './columnUpdates'
import type { ActionOf, WorkspaceState } from './workspaceTypes'

export function sessionOpen(state: WorkspaceState, action: ActionOf<'session/open'>): WorkspaceState {
  const openSessions = new Map(state.openSessions).set(action.session.sessionId, action.session)
  if (action.split) {
    const result = openBeside(state.layout, state.activeColumnId, {
      key: action.session.sessionId, view: 'transcript',
    })
    return {
      ...state,
      openSessions,
      layout: tidyLayout(result.layout, result.paneId),
      activeColumnId: result.paneId,
    }
  }
  const existing = findColumnWithTab(state.layout.panes, action.session.sessionId)
  if (existing) {
    const layout = updateColumns(state.layout, existing.id, (c) => (
      c.id === existing.id ? openTab(c, action.session.sessionId) : c
    ))
    return { ...state, openSessions, layout, activeColumnId: existing.id }
  }
  const targetId = targetColumnId(state, state.activeColumnId ?? undefined)
  const layout = updateColumns(state.layout, state.activeColumnId, (c) => (
    c.id === targetId ? openTab(c, action.session.sessionId) : c
  ))
  return { ...state, openSessions, layout }
}

export function tabActivate(state: WorkspaceState, action: ActionOf<'tab/activate'>): WorkspaceState {
  const layout = updateColumns(state.layout, action.columnId, (c) => (
    c.id === action.columnId ? openTab(c, action.key) : c
  ))
  return { ...state, layout, activeColumnId: action.columnId }
}

export function tabClose(state: WorkspaceState, action: ActionOf<'tab/close'>): WorkspaceState {
  const layout = updateColumns(state.layout, state.activeColumnId, (c) => (
    c.id === action.columnId ? closeTab(c, action.key) : c
  ))
  return { ...state, layout }
}

export function tabSetView(state: WorkspaceState, action: ActionOf<'tab/setView'>): WorkspaceState {
  const layout = updateColumns(state.layout, state.activeColumnId, (c) => (
    c.id === action.columnId ? setTabView(c, action.key, action.view) : c
  ))
  return { ...state, layout }
}

export function tabMove(state: WorkspaceState, action: ActionOf<'tab/move'>): WorkspaceState {
  const panes = moveTabToColumn(state.layout.panes, action.key, action.toColumnId, action.toIndex)
  const layout = tidyLayout({ ...state.layout, panes }, action.toColumnId)
  return { ...state, layout, activeColumnId: action.toColumnId }
}

export function tabAdopt(state: WorkspaceState, action: ActionOf<'tab/adopt'>): WorkspaceState {
  const { transfer } = action
  const shellKey = transfer.ptyId ?? transfer.key
  const ptyOverrides = transfer.ptyId !== null && state.ptyOverrides.get(transfer.key) !== transfer.ptyId
    ? new Map(state.ptyOverrides).set(transfer.key, transfer.ptyId)
    : state.ptyOverrides
  const shellTabs = transfer.shells.length > 0
    ? new Map(state.shellTabs).set(shellKey, transfer.shells)
    : state.shellTabs
  const activeTerminal = transfer.activeShell !== null
    ? new Map(state.activeTerminal).set(shellKey, transfer.activeShell)
    : state.activeTerminal
  const targetId = targetColumnId(state, state.activeColumnId ?? undefined)
  const target = state.layout.panes.find((c) => c.id === targetId)
  const layout = target === undefined
    ? state.layout
    : tidyLayout(
      { ...state.layout, panes: adoptTab(state.layout.panes, transfer.key, target.id, target.tabs.length, transfer.view) },
      state.activeColumnId,
    )
  return { ...state, layout, ptyOverrides, shellTabs, activeTerminal }
}

export function columnFocus(state: WorkspaceState, action: ActionOf<'column/focus'>): WorkspaceState {
  return state.activeColumnId === action.columnId ? state : { ...state, activeColumnId: action.columnId }
}

export function tabOpen(state: WorkspaceState, action: ActionOf<'tab/open'>): WorkspaceState {
  const targetId = targetColumnId(state, state.activeColumnId ?? undefined)
  const layout = updateColumns(state.layout, state.activeColumnId, (c) => (
    c.id === targetId ? openTab(c, action.key) : c
  ))
  return { ...state, layout }
}

export function tabFocus(state: WorkspaceState, action: ActionOf<'tab/focus'>): WorkspaceState {
  const existing = findColumnWithTab(state.layout.panes, action.key)
  if (existing === null) return state
  const layout = updateColumns(state.layout, state.activeColumnId, (c) => (
    c.id === existing.id ? openTab(c, action.key) : c
  ))
  return { ...state, layout, activeColumnId: existing.id }
}

export function tabCloseEverywhere(state: WorkspaceState, action: ActionOf<'tab/closeEverywhere'>): WorkspaceState {
  const layout = updateColumns(state.layout, state.activeColumnId, (c) => closeTab(c, action.key))
  return { ...state, layout }
}

export function tabShowView(state: WorkspaceState, action: ActionOf<'tab/showView'>): WorkspaceState {
  const layout = updateColumns(state.layout, state.activeColumnId, (c) => setTabView(c, action.key, action.view))
  return { ...state, layout }
}

export function tabSplit(state: WorkspaceState, action: ActionOf<'tab/split'>): WorkspaceState {
  const tab = state.layout.panes.flatMap((c) => c.tabs).find((t) => t.key === action.key)
  if (tab === undefined) return state
  const result = openBeside(state.layout, state.activeColumnId, { ...tab })
  return { ...state, layout: tidyLayout(result.layout, result.paneId), activeColumnId: result.paneId }
}

export function layoutPlace(state: WorkspaceState, action: ActionOf<'layout/place'>): WorkspaceState {
  const openSessions = action.session === undefined
    ? state.openSessions
    : new Map(state.openSessions).set(action.session.sessionId, action.session)
  const result = placeInZone(state.layout, action.preset, action.zone, action.key, action.paneId)
  return { ...state, openSessions, layout: tidyLayout(result.layout, result.paneId), activeColumnId: result.paneId }
}

export function layoutApply(state: WorkspaceState, action: ActionOf<'layout/apply'>): WorkspaceState {
  const layout = tidyLayout(applyPreset(state.layout, action.preset), state.activeColumnId)
  return layout === state.layout ? state : { ...state, layout }
}

export function layoutClosePane(state: WorkspaceState, action: ActionOf<'layout/closePane'>): WorkspaceState {
  const layout = tidyLayout(closePane(state.layout, action.columnId, state.activeColumnId), state.activeColumnId)
  return layout === state.layout ? state : { ...state, layout }
}

export function layoutSwap(state: WorkspaceState, action: ActionOf<'layout/swap'>): WorkspaceState {
  const layout = tidyLayout(swapPanes(state.layout, action.from, action.to), state.activeColumnId)
  return layout === state.layout ? state : { ...state, layout }
}

export function layoutFold(state: WorkspaceState, action: ActionOf<'layout/fold'>): WorkspaceState {
  const layout = tidyLayout(setFolded(state.layout, action.columnId, action.folded), state.activeColumnId)
  return layout === state.layout ? state : { ...state, layout }
}
