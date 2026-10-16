import { type JSX, memo, useState, type ReactNode } from 'react'
import type { PtyId } from '@shared/domain/ids'
import type { SessionNode, NewSessionInfo, TabTransfer } from '@shared/types'
import type { Column, OpenTab } from '../../state/columns'
import { SessionTabBar } from './SessionTabBar'
import { usePluginBar } from './pluginBar'
import { ImageLightbox } from '../transcript'
import { useLayoutActions, useLayoutState } from '../layout'
import { PaneDropOverlay } from './PaneDropOverlay'
import { SessionHeader } from './SessionHeader'
import { ViewToggle } from './ViewToggle'
import { useTerminalHandoff } from './useTerminalHandoff'
import { SessionBody } from './SessionBody'
import { ShellPane } from './ShellPane'
import { useColumnSession } from './useColumnSession'
import { ColumnGitDialogs } from './ColumnGitDialogs'
import { useGitStatus } from './useGitStatus'
import { useGitActions } from './useGitActions'
import { useShellTerminals } from './useShellTerminals'
import type { ResizeSeparatorProps } from '../../ui/useResizeDrag'
import type { FoldState } from '../../state/layout'
import { usePaneActivity } from '../../state/activeTabsStore'


interface Props {
  column: Column
  bottomHeight: number
  /** Everything `.bottom-resizer` needs to be a draggable, keyboard-operable separator. */
  bottomResizer: ResizeSeparatorProps
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
  /** Whether this pane can fold to its tab bar, or is folded (`foldState` in state/layout.ts). */
  fold?: FoldState
  onFold?: (folded: boolean) => void
}

/**
 * One editor group: a strip of session tabs, the active session's transcript or terminal, and its
 * own shell pane underneath. A split gives a second session and a second set of terminals.
 *
 * Memoized: with App's props stable (tests/component/appPropStability.test.tsx) a column whose own
 * tabs did not change skips renders caused by other panes.
 */
function SessionColumnView(props: Props): JSX.Element {
  const {
    column, bottomHeight, bottomResizer,
    terminalListWidth = null, onTerminalListWidth, isActive, onFocus,
    onActivateTab, onCloseTab, onSetView, onResume, onResumeAsync, onRenameSession, onRenamePending,
    onSplitActive, onReorderTab, transferFor, pinnedKeys, onTogglePin, onFork, onTabDropped, onDetach,
    onSessionStarted,
    gridArea, emptyContent, layoutButton, fold = 'none', onFold,
  } = props
  const folded = fold === 'folded'
  // Folded, the pane's body is hidden, so its bar says when something inside is still working.
  const paneActivity = usePaneActivity(folded ? column.tabs.map((t) => t.key) : [])

  const [lightbox, setLightbox] = useState<string | null>(null)
  const {
    workspace, resumed, activeKey, activeSession, activePending, keyFor, shellKey, terminal,
    tabViews, viewOf, showTerminalFor, activeView,
  } = useColumnSession(column)

  const { gitStatus, loadGitStatus } = useGitStatus(terminal)
  // The branch decides which merge request (if any) belongs to the session in front.
  const { items: pluginItems } = usePluginBar(terminal, gitStatus?.branch ?? null)
  const git = useGitActions({ terminal, gitStatus, loadGitStatus, onSessionStarted })
  const shell = useShellTerminals({ activeKey, terminal, isActive, keyFor, workspace })

  const terminalHandoff = useTerminalHandoff(activeSession, onResume)
  const { dropPaneOn } = useLayoutActions()
  const { movingPane } = useLayoutState()

  return (
    <section
      className="session-column"
      data-testid="session-column"
      data-column-id={column.id}
      // The pets walk under it to point at the session in front (features/pets).
      data-session-key={activeKey ?? undefined}
      style={{ gridArea }}
      data-active={isActive}
      data-placeholder={column.placeholder === true}
      data-folded={folded}
      data-pane-activity={folded ? paneActivity ?? undefined : undefined}
      onFocusCapture={onFocus}
      onMouseDownCapture={onFocus}
    >
      <PaneDropOverlay columnId={column.id} movingPane={movingPane} onDrop={dropPaneOn} />
      <div className="session-card" data-testid="session-card" data-glow={foldedGlow(folded, paneActivity)}>
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
        fold={fold}
        onFold={onFold}
        viewToggle={activePending === null && activeSession !== null
          && <ViewToggle session={activeSession} view={activeView} hasTerminal={resumed.has(activeSession.sessionId)} onView={onSetView} handoff={terminalHandoff} />}
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
            handoff={terminalHandoff.handoff}
            onRenamePending={onRenamePending}
            onRenameSession={onRenameSession}
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
          bottomResizer={bottomResizer}
          terminalListWidth={terminalListWidth}
          onTerminalListWidth={onTerminalListWidth}
        />
      )}
      </div>

      {lightbox !== null && <ImageLightbox src={lightbox} onClose={() => setLightbox(null)} />}

      <ColumnGitDialogs
        terminal={terminal}
        git={git}
        gitStatus={gitStatus}
        loadGitStatus={loadGitStatus}
        shellKey={shellKey}
      />
    </section>
  )
}

/** A folded pane still working wears the tabs' travelling border glow (`[data-glow]`, styles/05-ui.css). */
function foldedGlow(folded: boolean, activity: 'running' | 'waiting' | null): 'running' | 'waiting' | undefined {
  return folded ? activity ?? undefined : undefined
}

export const SessionColumn = memo(SessionColumnView)
