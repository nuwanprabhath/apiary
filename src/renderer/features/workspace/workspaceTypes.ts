/** The shapes `workspaceReducer` works on: the window's state and every action that changes it. */
import type { PtyId } from '@shared/domain/ids'
import type { NewSessionInfo, ProjectNode, SessionNode, TabTransfer } from '@shared/types'
import type { OpenTab } from '../../state/columns'
import type { Layout, PresetId } from '../../state/layout'

/** A shell terminal tab, as SessionColumn keys it. Declared here because state must not import a component. */
export interface TerminalTab { id: string; name: string }

/** A brand-new session's terminal, kept until the watcher discovers its real session id. */
export interface PendingSession extends NewSessionInfo {
  knownSessionIds: Set<string>
  titleOverride: string | null
}

export interface WorkspaceState {
  layout: Layout
  activeColumnId: string | null
  openSessions: Map<string, SessionNode>
  resumed: Set<string>
  ptyOverrides: Map<string, PtyId>
  pending: Map<string, PendingSession>
  shellTabs: Map<string, TerminalTab[]>
  activeTerminal: Map<string, string>
}

export type WorkspaceAction =
  /** Opens a session in the focused column, or beside it in a new column when `split`. A session
   *  already open elsewhere is focused there instead. */
  | { type: 'session/open'; session: SessionNode; split: boolean }
  | { type: 'tab/activate'; columnId: string; key: string }
  /** Closes a tab, dropping its column with it unless it is the last one. */
  | { type: 'tab/close'; columnId: string; key: string }
  | { type: 'tab/setView'; columnId: string; key: string; view: OpenTab['view'] }
  | { type: 'tab/move'; key: string; toColumnId: string; toIndex: number }
  /** A tab dragged in from another window: the pty, its shells and its active shell arrive with
   *  it, and it lands at the end of the active (or first) column. */
  | { type: 'tab/adopt'; transfer: TabTransfer }
  | {
    type: 'pending/add'
    info: NewSessionInfo
    nodes: ProjectNode[]
    titleOverride?: string
    after?: string
  }
  /** A rename typed in before a pending session had a real id yet (the IPC call is the caller's job). */
  | { type: 'pending/title'; ptyId: PtyId; title: string }
  /**
   * A tab follows the session its terminal is actually on: a pending pty's session was found by
   * cwd (the reconciler), or a live pty's tab is keyed by a different session (the rekey). Both do
   * the same four updates. `from` is the pty id (reconcile) or the tab's current key (rekey).
   */
  | { type: 'session/follow'; from: string; to: SessionNode; ptyId: PtyId; titleOverride: string | null }
  /** A pty exited: drops the pending entry, closes a still-`new:` tab (a real session's tab
   *  survives and reads as stopped), and drops any shell terminal under this pty id. */
  | { type: 'pty/exited'; id: string }
  /** `ptyRunning` reported these keys are actually live — only ever adds. */
  | { type: 'pty/running'; keys: string[] }
  /** Unpinning is `ui` state, the caller's job. */
  | { type: 'session/removed'; sessionId: string }
  | { type: 'column/focus'; columnId: string }
  /** Opens a bare key (a pending pty id) in the active column, or the first when the active one
   *  is gone — without moving focus. */
  | { type: 'tab/open'; key: string }
  /** Focuses an already-open key where it is — a no-op when it is not open in this window. */
  | { type: 'tab/focus'; key: string }
  /** Closes a key in every column — a tab another window took (`onTabClaimed`). */
  | { type: 'tab/closeEverywhere'; key: string }
  /** Sets a key's view in every column that has it (resume → terminal; launch restore). */
  | { type: 'tab/showView'; key: string; view: OpenTab['view'] }
  | { type: 'tab/split'; key: string }
  /** A session, optionally with its row, placed in a zone. */
  | { type: 'layout/place'; key: string; preset: PresetId; zone: number; paneId?: string; session?: SessionNode }
  | { type: 'layout/apply'; preset: PresetId }
  | { type: 'layout/closePane'; columnId: string }
  | { type: 'layout/swap'; from: string; to: string }
  | { type: 'layout/fold'; columnId: string; folded: boolean }
  | { type: 'openSessions/set'; session: SessionNode }
  /** Fills in rows for tabs this window has no row for yet (a tab adopted as a bare key). */
  | { type: 'openSessions/merge'; nodes: SessionNode[] }
  /** `known` is every session by id. */
  | { type: 'openSessions/refresh'; known: Map<string, SessionNode> }
  | { type: 'resumed/add'; key: string }
  /** A chat moved onto a new session (`/clear`): its tabs follow, nothing about a terminal does. */
  | { type: 'chat/follow'; from: string; to: SessionNode }
  /** The session's terminal claude is gone because the session now runs as a chat. */
  | { type: 'resumed/remove'; key: string }
  /** SessionColumn's shell-tab and active-terminal maps are edited through updaters. */
  | { type: 'shellTabs/update'; update: (prev: Map<string, TerminalTab[]>) => Map<string, TerminalTab[]> }
  | { type: 'activeTerminal/update'; update: (prev: Map<string, string>) => Map<string, string> }

/** The action of one `type` — what a handler for that case receives. */
export type ActionOf<T extends WorkspaceAction['type']> = Extract<WorkspaceAction, { type: T }>
