import { type JSX, memo, useMemo, useState, type ReactNode } from 'react'
import { terminalRef, type PtyId } from '@shared/domain/ids'
import type { SessionNode, NewSessionInfo, TabTransfer } from '@shared/types'
import type { Column, OpenTab } from '../layout/columns'
import { findTab } from '../layout/columns'
import { SessionTabBar, type SessionTabView } from './SessionTabBar'
import { usePluginBar } from './pluginBar'
import { BranchSwitcher } from '../git/BranchSwitcher'
import { WorktreeConflictDialog } from '../git/WorktreeConflictDialog'
import { ImageLightbox } from '../transcript/ImageLightbox'
import { useNotifications } from '../../ui/notifications'
import { useLayoutActions, useLayoutState } from '../layout/layoutContext'
import { PaneDropOverlay } from './PaneDropOverlay'
import { SessionHeader } from './SessionHeader'
import { SessionBody } from './SessionBody'
import { ShellPane } from './ShellPane'
import { useSessionKeys } from './useSessionKeys'
import { useGitStatus } from './useGitStatus'
import { useGitActions } from './useGitActions'
import { useShellTerminals } from './useShellTerminals'
import type { PendingTabInfo } from './paneTypes'

export type { PendingTabInfo }

interface Props {
  column: Column
  /** Real sessions for this column's tabs, by tab key. Pending tabs are absent here. */
  sessions: Map<string, SessionNode>
  /** Pending new sessions by pty id — a tab whose key is in here has no session row yet. */
  pending: Map<string, PendingTabInfo>
  /** Session ids with a live `claude` pty behind them. */
  resumed: Set<string>
  bottomHeight: number
  onStartBottomResize: () => void
  /** The keyboard alternative to dragging `.bottom-resizer` (UI-27): steps `bottomHeight` by the
   *  given number of pixels (negative shrinks). */
  onBottomHeightStep: (delta: number) => void
  /** The terminal list's dragged width (null: fit the names), and how to change it. */
  terminalListWidth?: number | null
  onTerminalListWidth?: (width: number | null) => void
  isActive: boolean
  onFocus: () => void
  onActivateTab: (key: string) => void
  onCloseTab: (key: string) => void
  onSetView: (key: string, view: OpenTab['view']) => void
  onResume: (session: SessionNode) => void
  /** Resumes and resolves once the pty exists, so the composer can send straight afterwards. */
  onResumeAsync: (session: SessionNode) => Promise<void>
  onRenameSession: (session: SessionNode, title: string) => void
  onRenamePending: (ptyId: PtyId, title: string) => void
  /** Splits this column's active session into a column of its own beside it. */
  onSplitActive: (key: string) => void
  /** Moves a tab within this column's strip, after a drag. */
  onReorderTab: (key: string, toIndex: number, transfer: TabTransfer | null) => void
  transferFor?: (key: string) => TabTransfer
  /** Session ids in the sidebar's Pinned section, so the tab menu offers the right verb. */
  pinnedKeys: Set<string>
  onTogglePin: (key: string) => void
  /** A session started from this column that has no session id yet — the same bookkeeping the
   *  "+" button's new sessions go through. */
  onSessionStarted: (info: NewSessionInfo) => void
  /** Forks the session behind a tab, opening the fork beside it. */
  onFork: (key: string) => void
  /** A drag that ended with nothing in this window taking the tab. */
  onTabDropped: (key: string, at: { x: number; y: number }) => void
  /** Tears a tab off into a window of its own. */
  onDetach: (key: string, at: { x: number; y: number }) => void
  /** The grid zone this pane sits in (`z1`…`z4`), from the layout preset. */
  gridArea: string
  /** Shown in place of the "Select a session" message when this pane is waiting to be filled. */
  emptyContent?: ReactNode
  /** The window's layout button, when this pane is the one at the top-right corner. */
  layoutButton?: ReactNode
}

/**
 * One editor group: a strip of open session tabs, the active session's transcript or live
 * terminal, and that session's own shell pane underneath. Several of these sit side by side when
 * the user splits (see state/columns.ts), each with its own shell — so a split gives you a second
 * session *and* a second set of terminals, which is what "split the shell along with the session"
 * asks for.
 *
 * Memoized (UI-4): with App's props stable (see tests/component/appPropStability.test.tsx) a
 * column whose own tabs did not change skips the render an activity broadcast or another pane's
 * change would otherwise cost it. The shell terminals and workspace maps are read from context
 * (`useShellTerminals`, `useSessionKeys`), so no setter is threaded through.
 *
 * It composes `SessionHeader`, `SessionBody` and `ShellPane`; the git and shell state they share
 * lives in `useGitStatus`, `useGitActions` and `useShellTerminals`.
 */
function SessionColumnView(props: Props): JSX.Element {
  const {
    column, sessions, pending, resumed, bottomHeight, onStartBottomResize, onBottomHeightStep,
    terminalListWidth = null, onTerminalListWidth, isActive, onFocus,
    onActivateTab, onCloseTab, onSetView, onResume, onResumeAsync, onRenameSession, onRenamePending,
    onSplitActive, onReorderTab, transferFor, pinnedKeys, onTogglePin, onFork, onTabDropped, onDetach,
    onSessionStarted,
    gridArea, emptyContent, layoutButton,
  } = props

  // Failures raised in here go to the app-wide notification stack rather than an in-pane banner:
  // a message that only exists inside one column is easy to miss (and impossible to see at all
  // once you have switched to another column), and every kind of failure now reads the same way
  // wherever it came from.
  const { notify } = useNotifications()

  /** The image being shown full size, from either the transcript or the composer. */
  const [lightbox, setLightbox] = useState<string | null>(null)

  const activeKey = column.activeKey
  const activeTab = activeKey !== null ? findTab(column, activeKey) : null
  const activeSession = activeKey !== null ? sessions.get(activeKey) ?? null : null
  const activePending = activeKey !== null ? pending.get(activeKey) ?? null : null

  const { keyFor, isPtyKey } = useSessionKeys(pending)
  const shellKey = activeKey !== null ? keyFor(activeKey) : null
  const shellKeyIsPtyId = activeKey !== null && isPtyKey(activeKey)
  // One ref for every cwd-carrying call below, so the key and which kind it is cannot be separated.
  const terminal = useMemo(
    () => (shellKey === null ? null : terminalRef(shellKey, shellKeyIsPtyId)),
    [shellKey, shellKeyIsPtyId],
  )

  const { gitStatus, loadGitStatus } = useGitStatus(terminal)
  // Plugins are asked again when the branch changes, which is the event that decides which merge
  // request (if any) belongs to what is in front of you.
  const { items: pluginItems } = usePluginBar(terminal, gitStatus?.branch ?? null)
  const git = useGitActions({ terminal, gitStatus, loadGitStatus, onSessionStarted })
  const shell = useShellTerminals({ activeKey, terminal, isActive, keyFor })

  const tabViews: SessionTabView[] = column.tabs.map((tab) => {
    const p = pending.get(tab.key)
    if (p !== undefined) return { key: tab.key, label: p.label, isPending: true }
    return { key: tab.key, label: sessions.get(tab.key)?.title ?? tab.key, isPending: false }
  })

  /** A pending session has no transcript to show, so its tab is always the live terminal. */
  const viewOf = (tab: OpenTab): OpenTab['view'] => (pending.has(tab.key) ? 'terminal' : tab.view)
  const showTerminalFor = (tab: OpenTab): boolean =>
    pending.has(tab.key) || resumed.has(tab.key)

  const activeView = activeTab !== null ? viewOf(activeTab) : 'transcript'
  const { dropPaneOn } = useLayoutActions()
  const { movingPane } = useLayoutState()

  const { worktreeConflict } = git

  return (
    <section
      className="session-column"
      data-testid="session-column"
      data-column-id={column.id}
      // Which session is in front here — the pets walk under it to point at it (features/pets).
      data-session-key={activeKey ?? undefined}
      style={{ gridArea }}
      data-active={isActive}
      data-placeholder={column.placeholder === true}
      onFocusCapture={onFocus}
      onMouseDownCapture={onFocus}
    >
      <PaneDropOverlay columnId={column.id} movingPane={movingPane} onDrop={dropPaneOn} />
      {/* Two cards, the way VS Code floats its editor and its panel: the session (tabs, header,
       *  transcript or terminal) and, below it across the gap, the shell. The gap between them is
       *  the resize handle. */}
      <div className="session-card" data-testid="session-card">
      <SessionTabBar
        columnId={column.id}
        tabs={tabViews}
        activeKey={activeKey}
        onActivate={onActivateTab}
        onClose={onCloseTab}
        onSplitActive={() => { if (activeKey !== null) onSplitActive(activeKey) }}
        onDropTab={onReorderTab}
        transferFor={transferFor}
        pinnedKeys={pinnedKeys}
        onTogglePin={onTogglePin}
        onFork={onFork}
        onTabDropped={onTabDropped}
        onDetach={onDetach}
        layoutButton={layoutButton}
      />

      {activeKey === null ? (
        emptyContent ?? (
          <p className="empty" data-testid="content-empty">
            Select a session to see its chat.
          </p>
        )
      ) : (
        <>
          <SessionHeader
            activePending={activePending}
            activeSession={activeSession}
            activeView={activeView}
            hasTerminal={activeSession !== null && resumed.has(activeSession.sessionId)}
            onRenamePending={onRenamePending}
            onRenameSession={onRenameSession}
            onSetView={onSetView}
            onResume={onResume}
          />
          <SessionBody
            column={column}
            activeKey={activeKey}
            activeSession={activeSession}
            isPending={activePending !== null}
            activeView={activeView}
            viewOf={viewOf}
            showTerminalFor={showTerminalFor}
            keyFor={keyFor}
            running={activeSession !== null && resumed.has(activeSession.sessionId)}
            onResumeAsync={onResumeAsync}
            onSetView={onSetView}
            onOpenImage={setLightbox}
          />
        </>
      )}
      </div>

      {activeKey !== null && (
        <ShellPane
          column={column}
          activeKey={activeKey}
          keyFor={keyFor}
          shell={shell}
          git={git}
          gitStatus={gitStatus}
          pluginItems={pluginItems}
          bottomHeight={bottomHeight}
          onStartBottomResize={onStartBottomResize}
          onBottomHeightStep={onBottomHeightStep}
          terminalListWidth={terminalListWidth}
          onTerminalListWidth={onTerminalListWidth}
        />
      )}

      {lightbox !== null && <ImageLightbox src={lightbox} onClose={() => setLightbox(null)} />}

      {git.branchPicker !== null && terminal !== null && (
        <BranchSwitcher
          // Remounts (resetting the query, step and error) if the active tab changes under the
          // open modal — e.g. another window switching it — rather than quietly going on showing
          // the wrong repo's branches (UI-15 item 3).
          key={terminal.id}
          terminal={terminal}
          mode={git.branchPicker === 'merge' ? 'merge' : 'checkout'}
          startAt={git.branchPicker === 'create' ? 'name' : 'list'}
          currentBranch={gitStatus?.branch ?? null}
          onClose={() => git.setBranchPicker(null)}
          onCheckedOut={loadGitStatus}
          onError={(message) => notify({ kind: 'error', message })}
          onNotice={(message) => notify({ kind: 'success', message })}
          onBranchUpdated={loadGitStatus}
          onWorktreeConflict={git.setWorktreeConflict}
        />
      )}

      {worktreeConflict !== null && shellKey !== null && (
        <WorktreeConflictDialog
          conflict={worktreeConflict}
          busy={git.worktreeBusy}
          onCancel={() => git.setWorktreeConflict(null)}
          onPull={() => git.pullWorktreeBranch(worktreeConflict)}
          onOpenSession={() => git.openWorktreeSession(worktreeConflict)}
          onMoveOther={(otherTo) => git.moveOtherWorktree(worktreeConflict, otherTo)}
        />
      )}
    </section>
  )
}

export const SessionColumn = memo(SessionColumnView)
