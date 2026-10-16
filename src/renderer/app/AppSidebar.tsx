import { type Dispatch, type HTMLAttributes, type JSX, useCallback, useEffect, useMemo } from 'react'
import type { PtyId, SessionId } from '@shared/domain/ids'
import type { SessionNode } from '@shared/types'
import { Sidebar } from '../features/sidebar/Sidebar'
import type { PendingSession, WorkspaceAction } from '../features/workspace/workspaceReducer'
import { useAppSettings } from '../state/settingsStore'
import { useActiveTabs } from '../state/activeTabsStore'
import type { UiStateActions } from '../state/useUiState'
import { focusTabInWindow } from '../state/tabs'
import { killPty } from '../state/terminals'
import { onToggleSidebar } from '../state/windowChrome'
import { windowNumber } from '../state/windowParams'
import { SidebarIcon } from '../ui/icons'

/** Matches the View menu in main/menu.ts. */
const SIDEBAR_SHORTCUT = navigator.userAgent.includes('Mac') ? '⌘B' : 'Ctrl+Shift+B'

interface Props {
  uiState: UiStateActions
  dispatch: Dispatch<WorkspaceAction>
  /** Remounts the sidebar (after an import) so it reads the tree afresh. */
  treeNonce: number
  activeKey: string | null
  pending: Map<string, PendingSession>
  openKeys: Set<string>
  forkSession: (sessionId: SessionId) => Promise<void>
  onNewSession: (path: string) => Promise<void>
  onNewSessionInPickedFolder: () => Promise<string | null>
  resizerProps: HTMLAttributes<HTMLDivElement>
}

/**
 * The sidebar, the rail that stands in for it when hidden, and its resizer. Everything it hands
 * `Sidebar` is a stable reference (`Sidebar` is `React.memo`; see appPropStability.test.tsx): the
 * `useUiState` setters, and the memos and callbacks below.
 */
export function AppSidebar({
  uiState, dispatch, treeNonce, activeKey, pending, openKeys, forkSession,
  onNewSession, onNewSessionInPickedFolder, resizerProps,
}: Props): JSX.Element {
  const { ui, toggleSidebar } = uiState
  const activeTabs = useActiveTabs()
  const {
    revealActiveInSidebar, recentSectionEnabled, recentSectionHours, hideOldSessionsEnabled, hideOldSessionsDays, searchChatContent, searchSessionNotes,
  } = useAppSettings()

  const groupState = useMemo(() => ({
    groups: ui.groups,
    assignments: ui.groupAssignments,
    collapsed: ui.groupsCollapsed,
    folderOrder: ui.folderOrder,
  }), [ui.groups, ui.groupAssignments, ui.groupsCollapsed, ui.folderOrder])

  const collapsed = useMemo(() => new Set(ui.collapsed), [ui.collapsed])

  // Pending sessions not already reachable as a tab anywhere.
  const sidebarPending = useMemo(
    () => [...pending.values()]
      .filter((p) => !openKeys.has(p.ptyId) && !activeTabs.some((t) => t.key === p.ptyId))
      .map((p) => ({ ptyId: p.ptyId, label: p.titleOverride ?? p.label, cwd: p.cwd })),
    [pending, openKeys, activeTabs],
  )

  // A session already open somewhere is focused there, not opened again: a second copy would be
  // the same conversation and process. Splitting is the deliberate way to ask for two.
  const openSessionTab = useCallback((session: SessionNode, split: boolean) => {
    dispatch({ type: 'session/open', session, split })
  }, [dispatch])
  useEffect(() => onToggleSidebar(toggleSidebar), [toggleSidebar])
  const onSelect = useCallback((session: SessionNode) => { openSessionTab(session, false) }, [openSessionTab])
  const onSplitSession = useCallback((session: SessionNode) => { openSessionTab(session, true) }, [openSessionTab])
  const onFork = useCallback((sessionId: SessionId) => { void forkSession(sessionId) }, [forkSession])
  const onNew = useCallback((path: string) => { void onNewSession(path) }, [onNewSession])
  const onStopPending = useCallback((ptyId: PtyId) => { killPty(ptyId) }, [])
  const onSelectPending = useCallback((ptyId: PtyId) => {
    dispatch({ type: 'tab/open', key: ptyId })
  }, [dispatch])
  const onFocusTab = useCallback((w: number, key: string) => {
    // This window's own tab: select it here. Main would answer with the same `selectTab`, but a
    // remote window's `focusTab` is refused (it would raise a window on the work machine's screen).
    if (w === windowNumber()) dispatch({ type: 'tab/focus', key })
    else focusTabInWindow(w, key)
  }, [dispatch])

  return (
    <>
      {ui.sidebarHidden && (
        // A rail, so a hidden sidebar has a visible way back.
        <div className="sidebar-rail" data-testid="sidebar-rail">
          <button
            className="icon-button"
            data-testid="sidebar-show"
            title={`Show sidebar (${SIDEBAR_SHORTCUT})`}
            aria-label="Show sidebar"
            onClick={toggleSidebar}
          >
            <SidebarIcon />
          </button>
        </div>
      )}
      <Sidebar
        key={treeNonce}
        // Hidden, not unmounted, to keep its search text and scroll position.
        hidden={ui.sidebarHidden}
        onHide={toggleSidebar}
        hideTitle={`Hide sidebar (${SIDEBAR_SHORTCUT})`}
        onForkSession={onFork}
        selectedId={activeKey}
        revealId={revealActiveInSidebar ? activeKey : null}
        searchChatContent={searchChatContent}
        searchSessionNotes={searchSessionNotes}
        groupState={groupState}
        onGroupStateChange={uiState.setGroupState}
        onReorderPinned={uiState.reorderPinned}
        showAllWorktrees={ui.showAllWorktrees}
        createdWorktrees={ui.createdWorktrees}
        onToggleAllWorktrees={uiState.toggleAllWorktrees}
        onSelect={onSelect}
        onSplitSession={onSplitSession}
        collapsed={collapsed}
        onCollapsedChange={uiState.setCollapsed}
        onNewSession={onNew}
        onNewSessionInPickedFolder={onNewSessionInPickedFolder}
        pinned={ui.pinned}
        onTogglePin={uiState.togglePin}
        pinnedCollapsed={ui.pinnedCollapsed}
        onPinnedCollapsedChange={uiState.setPinnedCollapsed}
        recentSectionEnabled={recentSectionEnabled}
        recentSectionHours={recentSectionHours}
        hideOldSessionsEnabled={hideOldSessionsEnabled}
        hideOldSessionsDays={hideOldSessionsDays}
        dismissedRecent={ui.dismissedRecent}
        recentCollapsed={ui.recentCollapsed}
        onRecentCollapsedChange={uiState.setRecentCollapsed}
        onDismissRecent={uiState.dismissRecent}
        pending={sidebarPending}
        onStopPending={onStopPending}
        onSelectPending={onSelectPending}
        activeTabs={activeTabs}
        onFocusTab={onFocusTab}
      />
      {!ui.sidebarHidden && (
        <div className="sidebar-resizer" data-testid="sidebar-resizer" {...resizerProps} />
      )}
    </>
  )
}
