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
import { SessionBody } from './SessionBody'
import { ShellPane } from './ShellPane'
import { useColumnSession } from './useColumnSession'
import { ColumnGitDialogs } from './ColumnGitDialogs'
import { useGitStatus } from './useGitStatus'
import { useGitActions } from './useGitActions'
import { useShellTerminals } from './useShellTerminals'
import type { ResizeSeparatorProps } from '../../ui/useResizeDrag'


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
    column, bottomHeight, bottomResizer,
    terminalListWidth = null, onTerminalListWidth, isActive, onFocus,
    onActivateTab, onCloseTab, onSetView, onResume, onResumeAsync, onRenameSession, onRenamePending,
    onSplitActive, onReorderTab, transferFor, pinnedKeys, onTogglePin, onFork, onTabDropped, onDetach,
    onSessionStarted,
    gridArea, emptyContent, layoutButton,
  } = props

  /** The image being shown full size, from either the transcript or the composer. */
  const [lightbox, setLightbox] = useState<string | null>(null)
  const {
    workspace, resumed, activeKey, activeSession, activePending, keyFor, shellKey, terminal,
    tabViews, viewOf, showTerminalFor, activeView,
  } = useColumnSession(column)

  const { gitStatus, loadGitStatus } = useGitStatus(terminal)
  // Plugins are asked again when the branch changes, which is the event that decides which merge
  // request (if any) belongs to what is in front of you.
  const { items: pluginItems } = usePluginBar(terminal, gitStatus?.branch ?? null)
  const git = useGitActions({ terminal, gitStatus, loadGitStatus, onSessionStarted })
  const shell = useShellTerminals({ activeKey, terminal, isActive, keyFor, workspace })

  const { dropPaneOn } = useLayoutActions()
  const { movingPane } = useLayoutState()

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
          bottomResizer={bottomResizer}
          terminalListWidth={terminalListWidth}
          onTerminalListWidth={onTerminalListWidth}
        />
      )}

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

export const SessionColumn = memo(SessionColumnView)
