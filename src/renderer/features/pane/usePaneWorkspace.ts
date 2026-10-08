import type { SessionNode } from '@shared/types'
import type { PtyId } from '@shared/domain/ids'
import { ptyKeyOf, useWorkspaceSelector, type TerminalTab, type WorkspaceState } from '../workspace'
import type { PendingTabInfo } from './paneTypes'

/**
 * What one pane reads of the window's workspace: the entries that belong to its own tabs, and
 * nothing else (review §7.2). A pane used to take the whole of `openSessions`, `pending` and
 * `resumed` as props and the shell maps from context, so a change anywhere in the window — a
 * pending session in another pane, a shell added to another tab — rendered every pane. Each map
 * here is the subset for this pane's tabs and keeps its identity until one of those entries
 * changes, so `memo(SessionColumn)` holds for everything that is not this pane's business.
 */
export interface PaneWorkspace {
  /** The row behind each of this pane's tabs, where there is one. */
  sessions: ReadonlyMap<string, SessionNode>
  /** This pane's pending (not yet resolved) new sessions, by pty id. */
  pending: ReadonlyMap<string, PendingTabInfo>
  /** This pane's tabs whose session has a live process. */
  resumed: ReadonlySet<string>
  /** The pty id some of this pane's sessions were started under, by session id. */
  ptyOverrides: ReadonlyMap<string, PtyId>
  /** Shell terminals, by the key `keyFor(tab)` gives. */
  shellTabs: ReadonlyMap<string, TerminalTab[]>
  activeTerminal: ReadonlyMap<string, string>
}

function sameMap<V>(a: ReadonlyMap<string, V>, b: ReadonlyMap<string, V>, same: (x: V, y: V) => boolean = Object.is): boolean {
  if (a.size !== b.size) return false
  for (const [k, v] of a) {
    const other = b.get(k)
    if (other === undefined || !same(v, other)) return false
  }
  return true
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((k) => b.has(k))
}

function samePending(a: PendingTabInfo, b: PendingTabInfo): boolean {
  return a.ptyId === b.ptyId && a.cwd === b.cwd && a.label === b.label
}

function paneWorkspaceEqual(a: PaneWorkspace, b: PaneWorkspace): boolean {
  return sameMap(a.sessions, b.sessions)
    && sameMap(a.pending, b.pending, samePending)
    && sameSet(a.resumed, b.resumed)
    && sameMap(a.ptyOverrides, b.ptyOverrides)
    && sameMap(a.shellTabs, b.shellTabs)
    && sameMap(a.activeTerminal, b.activeTerminal)
}

function selectPane(state: WorkspaceState, tabKeys: readonly string[]): PaneWorkspace {
  const sessions = new Map<string, SessionNode>()
  const pending = new Map<string, PendingTabInfo>()
  const resumed = new Set<string>()
  const ptyOverrides = new Map<string, PtyId>()
  const shellTabs = new Map<string, TerminalTab[]>()
  const activeTerminal = new Map<string, string>()
  for (const key of tabKeys) {
    const session = state.openSessions.get(key)
    if (session !== undefined) sessions.set(key, session)
    const p = state.pending.get(key)
    if (p !== undefined) pending.set(key, { ptyId: p.ptyId, cwd: p.cwd, label: p.titleOverride ?? p.label })
    if (state.resumed.has(key)) resumed.add(key)
    const override = state.ptyOverrides.get(key)
    if (override !== undefined) ptyOverrides.set(key, override)
    const ptyKey = ptyKeyOf(state.pending, state.ptyOverrides, key)
    const shells = state.shellTabs.get(ptyKey)
    if (shells !== undefined) shellTabs.set(ptyKey, shells)
    const active = state.activeTerminal.get(ptyKey)
    if (active !== undefined) activeTerminal.set(ptyKey, active)
  }
  return { sessions, pending, resumed, ptyOverrides, shellTabs, activeTerminal }
}

/** The workspace entries behind a pane's tabs; re-renders the pane only when one of them changes. */
export function usePaneWorkspace(tabKeys: readonly string[]): PaneWorkspace {
  return useWorkspaceSelector((state) => selectPane(state, tabKeys), paneWorkspaceEqual)
}
