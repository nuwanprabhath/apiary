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

/** How the toggle's shortcut is written on this platform — see the View menu in main/menu.ts. */
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
    revealActiveInSidebar, recentSectionEnabled, recentSectionHours, searchChatContent, searchSessionNotes,
  } = useAppSettings()

  /** Sidebar's `groupState` — one object rather than four scalars, kept stable across renders that
   *  don't touch grouping so it never busts a memo below Sidebar on its own. */
  const groupState = useMemo(() => ({
    groups: ui.groups,
    assignments: ui.groupAssignments,
    collapsed: ui.groupsCollapsed,
    folderOrder: ui.folderOrder,
  }), [ui.groups, ui.groupAssignments, ui.groupsCollapsed, ui.folderOrder])

  const collapsed = useMemo(() => new Set(ui.collapsed), [ui.collapsed])

  /** Pending new sessions not already reachable as a tab anywhere — see Sidebar's own `pending`
   *  prop doc. Recomputed only when what it actually depends on changes. */
  const sidebarPending = useMemo(
    () => [...pending.values()]
      .filter((p) => !openKeys.has(p.ptyId) && !activeTabs.some((t) => t.key === p.ptyId))
      .map((p) => ({ ptyId: p.ptyId, label: p.titleOverride ?? p.label, cwd: p.cwd })),
    [pending, openKeys, activeTabs],
  )

  /**
   * Opens a session in the focused column, or in a brand-new column beside it when splitting.
   *
   * A session already open somewhere is focused where it is rather than opened again: the second
   * copy would be the same conversation and the same underlying process, so it reads as a split
   * that cannot be told apart from the first. Splitting is the way to ask for it twice deliberately.
   */
  const openSessionTab = useCallback((session: SessionNode, split: boolean) => {
    dispatch({ type: 'session/open', session, split })
  }, [dispatch])
  // The View menu's (and the shortcut's) sidebar toggle, sent by main.
  useEffect(() => onToggleSidebar(toggleSidebar), [toggleSidebar])
  const onSelect = useCallback((session: SessionNode) => { openSessionTab(session, false) }, [openSessionTab])
  /** The split button: same session, but in a column of its own beside the current one. */
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
        // A rail rather than nothing: a sidebar hidden with no visible way back is one someone has
        // to remember a shortcut to recover, which is a sidebar that has gone missing.
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
        // Hidden, not unmounted, so the search typed into it and where it was scrolled to are
        // still there when it comes back.
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
