/** The reducer's session, pending-session, pty and terminal-map transitions. */
import { ptyIdOfSession } from '@shared/domain/ids'
import type { ProjectNode } from '@shared/types'
import { isPendingPtyId, parseShellPtyId } from '@shared/domain/ptyId'
import { openTab, openTabAfter, closeTab, setTabView, rekeyTab, findColumnWithTab } from '../../state/columns'
import { dropKey, targetColumnId, updateColumns } from './columnUpdates'
import type { ActionOf, WorkspaceState } from './workspaceTypes'

/** Every session id present in the tree, to tell a freshly discovered session apart from one that
 *  already existed before a pending request. */
function collectSessionIds(nodes: ProjectNode[]): Set<string> {
  const ids = new Set<string>()
  const walk = (list: ProjectNode[]): void => {
    for (const node of list) {
      for (const s of node.sessions) ids.add(s.sessionId)
      walk(node.children)
    }
  }
  walk(nodes)
  return ids
}

export function pendingAdd(state: WorkspaceState, action: ActionOf<'pending/add'>): WorkspaceState {
  const knownSessionIds = collectSessionIds(action.nodes)
  const pending = new Map(state.pending).set(action.info.ptyId, {
    ...action.info,
    knownSessionIds,
    titleOverride: action.titleOverride ?? null,
  })
  const { after } = action
  const home = after === undefined ? null : findColumnWithTab(state.layout.panes, after)
  const targetId = home?.id ?? targetColumnId(state, state.activeColumnId ?? undefined)
  const layout = updateColumns(state.layout, state.activeColumnId, (c) => {
    if (c.id !== targetId) return c
    return after !== undefined && home !== null
      ? openTabAfter(c, action.info.ptyId, after)
      : openTab(c, action.info.ptyId)
  })
  return { ...state, pending, layout }
}

export function pendingTitle(state: WorkspaceState, action: ActionOf<'pending/title'>): WorkspaceState {
  const info = state.pending.get(action.ptyId)
  if (!info) return state
  const pending = new Map(state.pending).set(action.ptyId, { ...info, titleOverride: action.title })
  return { ...state, pending }
}

export function sessionFollow(state: WorkspaceState, action: ActionOf<'session/follow'>): WorkspaceState {
  const { from, to, ptyId, titleOverride } = action
  const node = titleOverride !== null ? { ...to, title: titleOverride } : to
  const ptyOverrides = new Map(state.ptyOverrides)
  ptyOverrides.delete(from)
  if (ptyId !== ptyIdOfSession(to.sessionId)) ptyOverrides.set(to.sessionId, ptyId)
  const resumed = new Set(state.resumed)
  resumed.delete(from)
  resumed.add(to.sessionId)
  const openSessions = new Map(state.openSessions)
  openSessions.delete(from)
  openSessions.set(to.sessionId, node)
  const layout = updateColumns(state.layout, state.activeColumnId, (c) => (
    setTabView(rekeyTab(c, from, to.sessionId), to.sessionId, 'terminal')
  ))
  const pending = state.pending.has(from) ? dropKey(state.pending, from) : state.pending
  return { ...state, ptyOverrides, resumed, openSessions, layout, pending }
}

export function ptyExited(state: WorkspaceState, action: ActionOf<'pty/exited'>): WorkspaceState {
  const { id } = action
  const pending = state.pending.has(id) ? dropKey(state.pending, id) : state.pending
  const layout = isPendingPtyId(id)
    ? updateColumns(state.layout, state.activeColumnId, (c) => closeTab(c, id))
    : state.layout
  const shell = parseShellPtyId(id)
  if (shell === null) return { ...state, pending, layout }
  const { owner: key, terminalId } = shell
  const existing = state.shellTabs.get(key) ?? []
  const list = existing.filter((t) => t.id !== terminalId)
  const shellTabs = list.length === existing.length
    ? state.shellTabs
    : (() => {
      const next = new Map(state.shellTabs)
      if (list.length === 0) next.delete(key)
      else next.set(key, list)
      return next
    })()
  const activeTerminal = state.activeTerminal.get(key) === terminalId
    ? dropKey(state.activeTerminal, key)
    : state.activeTerminal
  return { ...state, pending, layout, shellTabs, activeTerminal }
}

export function ptyRunning(state: WorkspaceState, action: ActionOf<'pty/running'>): WorkspaceState {
  const missing = action.keys.filter((k) => !state.resumed.has(k))
  if (missing.length === 0) return state
  return { ...state, resumed: new Set([...state.resumed, ...missing]) }
}

export function sessionRemoved(state: WorkspaceState, action: ActionOf<'session/removed'>): WorkspaceState {
  const { sessionId } = action
  const layout = updateColumns(state.layout, state.activeColumnId, (c) => closeTab(c, sessionId))
  const openSessions = state.openSessions.has(sessionId)
    ? dropKey(state.openSessions, sessionId)
    : state.openSessions
  return { ...state, layout, openSessions }
}

export function openSessionsSet(state: WorkspaceState, action: ActionOf<'openSessions/set'>): WorkspaceState {
  return { ...state, openSessions: new Map(state.openSessions).set(action.session.sessionId, action.session) }
}

export function openSessionsMerge(state: WorkspaceState, action: ActionOf<'openSessions/merge'>): WorkspaceState {
  if (action.nodes.length === 0) return state
  const openSessions = new Map(state.openSessions)
  for (const node of action.nodes) openSessions.set(node.sessionId, node)
  return { ...state, openSessions }
}

export function openSessionsRefresh(state: WorkspaceState, action: ActionOf<'openSessions/refresh'>): WorkspaceState {
  if (state.openSessions.size === 0) return state
  let changed = false
  const next = new Map(state.openSessions)
  for (const [id, current] of state.openSessions) {
    const fresh = action.known.get(id) ?? null
    if (fresh === null) continue
    if (
      fresh.title !== current.title ||
      fresh.isLive !== current.isLive ||
      fresh.cwd !== current.cwd ||
      fresh.cwdExists !== current.cwdExists
    ) {
      next.set(id, fresh)
      changed = true
    }
  }
  return changed ? { ...state, openSessions: next } : state
}

export function resumedAdd(state: WorkspaceState, action: ActionOf<'resumed/add'>): WorkspaceState {
  return state.resumed.has(action.key) ? state : { ...state, resumed: new Set([...state.resumed, action.key]) }
}

export function chatFollow(state: WorkspaceState, action: ActionOf<'chat/follow'>): WorkspaceState {
  const { from, to } = action
  if (!state.layout.panes.some((c) => c.tabs.some((t) => t.key === from))) return state
  const openSessions = new Map(state.openSessions)
  openSessions.delete(from)
  openSessions.set(to.sessionId, to)
  const layout = updateColumns(state.layout, state.activeColumnId, (c) => rekeyTab(c, from, to.sessionId))
  return { ...state, openSessions, layout }
}

export function resumedRemove(state: WorkspaceState, action: ActionOf<'resumed/remove'>): WorkspaceState {
  if (!state.resumed.has(action.key)) return state
  const resumed = new Set(state.resumed)
  resumed.delete(action.key)
  // With no terminal left, a tab showing it would show nothing: back to the transcript.
  const layout = updateColumns(state.layout, state.activeColumnId, (c) => setTabView(c, action.key, 'transcript'))
  return { ...state, resumed, layout }
}

export function shellTabsUpdate(state: WorkspaceState, action: ActionOf<'shellTabs/update'>): WorkspaceState {
  const shellTabs = action.update(state.shellTabs)
  return shellTabs === state.shellTabs ? state : { ...state, shellTabs }
}

export function activeTerminalUpdate(state: WorkspaceState, action: ActionOf<'activeTerminal/update'>): WorkspaceState {
  const activeTerminal = action.update(state.activeTerminal)
  return activeTerminal === state.activeTerminal ? state : { ...state, activeTerminal }
}
