/** The shapes `workspaceReducer` works on: the window's state and every action that changes it. */
import type { PtyId } from '@shared/domain/ids'
import type { NewSessionInfo, ProjectNode, SessionNode, TabTransfer } from '@shared/types'
import type { OpenTab } from '../../state/columns'
import type { Layout, PresetId } from '../../state/layout'

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
  ptyOverrides: Map<string, PtyId>
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
  | { type: 'pending/title'; ptyId: PtyId; title: string }
  /**
   * A still-pending pty's session was found by matching its cwd against the tree (the reconciler),
   * or a live pty's tab was found to be on a different session than it is keyed by (the rekey
   * effect) — both fold into one case because both do the same four updates (App.tsx: the
   * reconciler at 526–568 and the rekey at 640–685 "do the same four updates"). `from` is the pty
   * id (reconcile) or the tab's current key (rekey); they are the same case a resolving pending
   * session and a live rekey both are — a tab following the session its terminal is actually on.
   */
  | { type: 'session/follow'; from: string; to: SessionNode; ptyId: PtyId; titleOverride: string | null }
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
  /** Focuses a pane without touching its tabs. */
  | { type: 'column/focus'; columnId: string }
  /** Opens a bare key (a pending pty id) in the active column, or the first when the active one
   *  is gone — without moving focus. Ports the sidebar's "select pending". */
  | { type: 'tab/open'; key: string }
  /** Focuses an already-open key where it is — a no-op when it is not open in this window. Ports
   *  `onSelectTab` (another window's Active row was clicked). */
  | { type: 'tab/focus'; key: string }
  /** Closes a key in every column — a tab another window took (`onTabClaimed`). */
  | { type: 'tab/closeEverywhere'; key: string }
  /** Sets a key's view in every column that has it (resume → terminal; launch restore). */
  | { type: 'tab/showView'; key: string; view: OpenTab['view'] }
  /** The tab bar's split button: the tab copied into a pane beside the active one. */
  | { type: 'tab/split'; key: string }
  /** The layout picker's "Arrange": place a key (a session, optionally with its row) in a zone. */
  | { type: 'layout/place'; key: string; preset: PresetId; zone: number; paneId?: string; session?: SessionNode }
  | { type: 'layout/apply'; preset: PresetId }
  | { type: 'layout/closePane'; columnId: string }
  | { type: 'layout/swap'; from: string; to: string }
  /** Remembers the row behind an open tab (a rename, a drop onto an empty pane, ...). */
  | { type: 'openSessions/set'; session: SessionNode }
  /** Fills in rows for tabs this window has no row for yet (a tab adopted as a bare key). */
  | { type: 'openSessions/merge'; nodes: SessionNode[] }
  /** Keeps rows behind open tabs current from a fresh tree (`known` is every session by id). */
  | { type: 'openSessions/refresh'; known: Map<string, SessionNode> }
  /** A session's process was started: it now reads as resumed. */
  | { type: 'resumed/add'; key: string }
  /** A chat moved onto a new session (`/clear`): its tabs follow, nothing about a terminal does. */
  | { type: 'chat/follow'; from: string; to: SessionNode }
  /** The session's terminal claude is gone because the session now runs as a chat. */
  | { type: 'resumed/remove'; key: string }
  /** SessionColumn's shell-tab and active-terminal maps are edited through updaters, as they were
   *  when they were `useState`s there. */
  | { type: 'shellTabs/update'; update: (prev: Map<string, TerminalTab[]>) => Map<string, TerminalTab[]> }
  | { type: 'activeTerminal/update'; update: (prev: Map<string, string>) => Map<string, string> }

/** The action of one `type` — what a handler for that case receives. */
export type ActionOf<T extends WorkspaceAction['type']> = Extract<WorkspaceAction, { type: T }>
