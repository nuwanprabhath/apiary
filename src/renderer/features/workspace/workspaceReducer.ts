/**
 * The pure state transitions behind an App window's open tabs, terminals and pane layout.
 *
 * This exists to take the "hand-ordered cluster of setters" App.tsx used to run these as (a rekey
 * was six separate `useState` setter calls; the cwd reconciler was five) and make each transition
 * one atomic, testable update. Every case here ports an *existing* transition's exact semantics —
 * see the case-by-case comments for the App.tsx behaviour each one replaces. Side effects (IPC
 * calls such as `renameSession`, `logWrite`) are deliberately not here: callers decide those, then
 * dispatch the resulting action. This module must stay pure — no `window`, no React.
 */
import type { NewSessionInfo, ProjectNode, SessionNode, TabTransfer } from '@shared/types'
import { isPendingPtyId, parseShellPtyId } from '@shared/domain/ptyId'
import {
  openTab, openTabAfter, closeTab, setTabView, rekeyTab, moveTabToColumn, adoptTab,
  findColumnWithTab, type Column, type OpenTab,
} from '../layout/columns'
import { tidyLayout, openBeside, type Layout, type PresetId } from '../layout/layout'

/** A shell terminal tab, as SessionColumn keys it — duplicated here rather than imported from a
 *  component module, since a state module importing a component would invert the dependency this
 *  file needs to keep (SessionColumn depends on state, not the other way round). */
export interface TerminalTab { id: string; name: string }

/** A brand-new session's terminal, kept until the watcher discovers its real session id — see
 *  App.tsx's own `PendingSession` doc comment, which this ports verbatim. */
export interface PendingSession extends NewSessionInfo {
  knownSessionIds: Set<string>
  titleOverride: string | null
}

export interface WorkspaceState {
  layout: Layout
  activeColumnId: string | null
  openSessions: Map<string, SessionNode>
  resumed: Set<string>
  ptyOverrides: Map<string, string>
  pending: Map<string, PendingSession>
  shellTabs: Map<string, TerminalTab[]>
  activeTerminal: Map<string, string>
}

export type WorkspaceAction =
  /** Opens a session in the focused column, or beside it in a new column when `split`. Ports
   *  `openSessionTab` (App.tsx). A session already open elsewhere is focused there instead. */
  | { type: 'session/open'; session: SessionNode; split: boolean }
  /** Activates an existing tab in `columnId` — ports the plain (non-split) branch of
   *  `openSessionTab` and `onSelectTab`/pending-select handlers, which all just call `openTab`. */
  | { type: 'tab/activate'; columnId: string; key: string }
  /** Closes a tab, dropping its column with it unless it is the last one. Ports `closeSessionTab`. */
  | { type: 'tab/close'; columnId: string; key: string }
  /** Sets one tab's view within one column. Ports the `onSetView` column handler. */
  | { type: 'tab/setView'; columnId: string; key: string; view: OpenTab['view'] }
  /** Moves a tab already open in this window to another column/index. Ports the `onReorderTab`
   *  in-window branch. */
  | { type: 'tab/move'; key: string; toColumnId: string; toIndex: number }
  /** A tab dragged in from another window. Ports `onTabAdopt`: the pty, its shells and its active
   *  shell arrive with it, and it lands at the end of the active (or first) column. */
  | { type: 'tab/adopt'; transfer: TabTransfer }
  /** Registers a freshly started new session as pending and opens it as a tab. Ports `addPending`. */
  | {
    type: 'pending/add'
    info: NewSessionInfo
    nodes: ProjectNode[]
    titleOverride?: string
    after?: string
  }
  /** A rename typed in before a pending session had a real id yet. Ports the state half of
   *  `setPendingTitle` (the `renameTerminalInClaude` IPC call is the caller's job). */
  | { type: 'pending/title'; ptyId: string; title: string }
  /**
   * A still-pending pty's session was found by matching its cwd against the tree (the reconciler),
   * or a live pty's tab was found to be on a different session than it is keyed by (the rekey
   * effect) — both fold into one case because both do the same four updates (App.tsx: the
   * reconciler at 526–568 and the rekey at 640–685 "do the same four updates"). `from` is the pty
   * id (reconcile) or the tab's current key (rekey); they are the same case a resolving pending
   * session and a live rekey both are — a tab following the session its terminal is actually on.
   */
  | { type: 'session/follow'; from: string; to: SessionNode; ptyId: string; titleOverride: string | null }
  /** A pty exited. Ports the `onPtyExit` handler: drops the pending entry, closes a still-`new:`
   *  tab (a real session's tab survives and reads as stopped), and drops any shell terminal that
   *  was running under this pty id. */
  | { type: 'pty/exited'; id: string }
  /** `ptyRunning` reported these keys are actually live — only ever adds. Ports the effect at
   *  App.tsx 1101–1118. */
  | { type: 'pty/running'; keys: string[] }
  /** A session was removed from the library. Ports `confirmDelete`'s tab/session bookkeeping
   *  (unpinning is `ui` state and stays the caller's job). */
  | { type: 'session/removed'; sessionId: string }

function targetColumnId(state: WorkspaceState, preferred?: string): string | undefined {
  const columns = state.layout.panes
  if (preferred !== undefined && columns.some((c) => c.id === preferred)) return preferred
  return columns[0]?.id
}

function updateColumns(layout: Layout, activeColumnId: string | null, fn: (c: Column) => Column): Layout {
  return tidyLayout({ ...layout, panes: layout.panes.map(fn) }, activeColumnId)
}

export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case 'session/open': {
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
      const targetId = targetColumnId(state)
      const layout = updateColumns(state.layout, state.activeColumnId, (c) => (
        c.id === targetId ? openTab(c, action.session.sessionId) : c
      ))
      return { ...state, openSessions, layout }
    }

    case 'tab/activate': {
      const layout = updateColumns(state.layout, action.columnId, (c) => (
        c.id === action.columnId ? openTab(c, action.key) : c
      ))
      return { ...state, layout, activeColumnId: action.columnId }
    }

    case 'tab/close': {
      const layout = updateColumns(state.layout, state.activeColumnId, (c) => (
        c.id === action.columnId ? closeTab(c, action.key) : c
      ))
      return { ...state, layout }
    }

    case 'tab/setView': {
      const layout = updateColumns(state.layout, state.activeColumnId, (c) => (
        c.id === action.columnId ? setTabView(c, action.key, action.view) : c
      ))
      return { ...state, layout }
    }

    case 'tab/move': {
      const panes = moveTabToColumn(state.layout.panes, action.key, action.toColumnId, action.toIndex)
      const layout = tidyLayout({ ...state.layout, panes }, action.toColumnId)
      return { ...state, layout, activeColumnId: action.toColumnId }
    }

    case 'tab/adopt': {
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

    case 'pending/add': {
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

    case 'pending/title': {
      const info = state.pending.get(action.ptyId)
      if (!info) return state
      const pending = new Map(state.pending).set(action.ptyId, { ...info, titleOverride: action.title })
      return { ...state, pending }
    }

    case 'session/follow': {
      const { from, to, ptyId, titleOverride } = action
      const node = titleOverride !== null ? { ...to, title: titleOverride } : to
      const ptyOverrides = new Map(state.ptyOverrides)
      ptyOverrides.delete(from)
      if (ptyId !== to.sessionId) ptyOverrides.set(to.sessionId, ptyId)
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

    case 'pty/exited': {
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

    case 'pty/running': {
      const missing = action.keys.filter((k) => !state.resumed.has(k))
      if (missing.length === 0) return state
      return { ...state, resumed: new Set([...state.resumed, ...missing]) }
    }

    case 'session/removed': {
      const { sessionId } = action
      const layout = updateColumns(state.layout, state.activeColumnId, (c) => closeTab(c, sessionId))
      const openSessions = state.openSessions.has(sessionId)
        ? dropKey(state.openSessions, sessionId)
        : state.openSessions
      return { ...state, layout, openSessions }
    }

    default:
      return state
  }
}

/** Every session id present in the tree — ports `collectSessionIds` (App.tsx), used to tell a
 *  freshly discovered session apart from one that already existed before a pending request. */
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

function dropKey<K, V>(map: Map<K, V>, key: K): Map<K, V> {
  const next = new Map(map)
  next.delete(key)
  return next
}

/** Every session id currently open in some column, matching `PRESETS`' shape — used by callers
 *  that need it (e.g. the pty/running effect) without walking `state.layout.panes` themselves. */
export function openKeysOf(state: WorkspaceState): Set<string> {
  return new Set(state.layout.panes.flatMap((c) => c.tabs.map((t) => t.key)))
}

export type { PresetId }
