/**
 * The pure state transitions behind an App window's open tabs, terminals and pane layout.
 *
 * This exists to take the "hand-ordered cluster of setters" App.tsx used to run these as (a rekey
 * was six separate `useState` setter calls; the cwd reconciler was five) and make each transition
 * one atomic, testable update. Every case here ports an *existing* transition's exact semantics —
 * see the case-by-case comments for the App.tsx behaviour each one replaces. Side effects (IPC
 * calls such as `renameSession`, `logWrite`) are deliberately not here: callers decide those, then
 * dispatch the resulting action. This module must stay pure — no `window`, no React.
 *
 * This file only routes: the types are in `workspaceTypes.ts`, the tab and layout transitions in
 * `tabReducers.ts`, the session, pending and pty ones in `sessionReducers.ts`.
 */
import {
  columnFocus, layoutApply, layoutClosePane, layoutPlace, layoutSwap, sessionOpen, tabActivate,
  tabAdopt, tabClose, tabCloseEverywhere, tabFocus, tabMove, tabOpen, tabSetView, tabShowView, tabSplit,
} from './tabReducers'
import {
  activeTerminalUpdate, chatFollow, openSessionsMerge, openSessionsRefresh, openSessionsSet,
  pendingAdd, pendingTitle, ptyExited, ptyRunning, resumedAdd, resumedRemove, sessionFollow,
  sessionRemoved, shellTabsUpdate,
} from './sessionReducers'
import type { WorkspaceAction, WorkspaceState } from './workspaceTypes'

export type { PendingSession, TerminalTab, WorkspaceAction, WorkspaceState } from './workspaceTypes'

export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case 'session/open': return sessionOpen(state, action)
    case 'tab/activate': return tabActivate(state, action)
    case 'tab/close': return tabClose(state, action)
    case 'tab/setView': return tabSetView(state, action)
    case 'tab/move': return tabMove(state, action)
    case 'tab/adopt': return tabAdopt(state, action)
    case 'pending/add': return pendingAdd(state, action)
    case 'pending/title': return pendingTitle(state, action)
    case 'session/follow': return sessionFollow(state, action)
    case 'pty/exited': return ptyExited(state, action)
    case 'pty/running': return ptyRunning(state, action)
    case 'session/removed': return sessionRemoved(state, action)
    case 'column/focus': return columnFocus(state, action)
    case 'tab/open': return tabOpen(state, action)
    case 'tab/focus': return tabFocus(state, action)
    case 'tab/closeEverywhere': return tabCloseEverywhere(state, action)
    case 'tab/showView': return tabShowView(state, action)
    case 'tab/split': return tabSplit(state, action)
    case 'layout/place': return layoutPlace(state, action)
    case 'layout/apply': return layoutApply(state, action)
    case 'layout/closePane': return layoutClosePane(state, action)
    case 'layout/swap': return layoutSwap(state, action)
    case 'openSessions/set': return openSessionsSet(state, action)
    case 'openSessions/merge': return openSessionsMerge(state, action)
    case 'openSessions/refresh': return openSessionsRefresh(state, action)
    case 'resumed/add': return resumedAdd(state, action)
    case 'chat/follow': return chatFollow(state, action)
    case 'resumed/remove': return resumedRemove(state, action)
    case 'shellTabs/update': return shellTabsUpdate(state, action)
    case 'activeTerminal/update': return activeTerminalUpdate(state, action)
    default: return state
  }
}

/** Every session id currently open in some column, matching `PRESETS`' shape — used by callers
 *  that need it (e.g. the pty/running effect) without walking `state.layout.panes` themselves. */
export function openKeysOf(state: WorkspaceState): Set<string> {
  return new Set(state.layout.panes.flatMap((c) => c.tabs.map((t) => t.key)))
}

