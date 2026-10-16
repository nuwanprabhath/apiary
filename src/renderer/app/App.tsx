import { type JSX, useMemo, useState } from 'react'
import {
  type TabTransfer, type WindowLayoutReport,
} from '@shared/types'
import { DialogHost } from '../features/dialogs/DialogHost'
import { useDialogs } from '../features/dialogs/useDialogs'
import { findColumnWithTab } from '../state/columns'
import { WorkspaceProvider } from '../features/workspace/WorkspaceProvider'
import { useWorkspaceDispatch, useWorkspaceStore } from '../features/workspace/workspaceContext'
import { useWorkspace } from '../features/workspace/useWorkspaceSelector'
import { detachedKey, detachedTransfer, remoteHost, restoredWindow, windowChrome } from '../state/windowParams'
import { useFolderBrowserRequest } from '../features/folderBrowser'
import { useUpdate } from '../state/updateStore'
import { useAppSettings } from '../state/settingsStore'
import { useUiState } from '../state/useUiState'
import { useLaunchRestore } from '../features/workspace/useLaunchRestore'
import { useNotifications } from '../ui/notifications'
import { AppSidebar } from './AppSidebar'
import { PaneColumns } from './PaneColumns'
import { useColumnHandlers } from './useColumnHandlers'
import { usePaneLayout } from './usePaneLayout'
import { useOpenTabKeys } from './useOpenTabKeys'
import { useResumeCommands } from './useResumeCommands'
import { useSessionStarters } from './useSessionStarters'
import { useWindowResizers } from './useWindowResizers'
import { ThemeEffectsLayer, WindowFooter, WindowHeader } from './windowRegions'
import { dialogHandlers } from './dialogHandlers'
import { layoutGridColumns } from './layoutGrid'
import { useRememberSelected } from './useRememberSelected'
import { useTabKeyHandlers } from './useTabKeyHandlers'
import { useTabTitleAndSettings } from './useTabTitleAndSettings'
import { useWindowReady } from './useWindowReady'
import { useWindowSync } from './useWindowSync'
import { useWorkspaceFollowing } from './useWorkspaceFollowing'
import { WindowContextProvider } from './windowContexts'

export function App(): JSX.Element {
  // The three are read once: a window does not stop being detached or restored. `restoredWindow`
  // returns null for a detached window, so `restored` and `detached` are mutually exclusive.
  const [detached] = useState<string | null>(detachedKey)
  const [arrival] = useState<TabTransfer | null>(detachedTransfer)
  const [restored] = useState<WindowLayoutReport | null>(restoredWindow)
  return (
    <WorkspaceProvider restored={restored} arrival={arrival}>
      <AppWindow detached={detached} arrival={arrival} restored={restored} />
    </WorkspaceProvider>
  )
}

/**
 * Everything an App window passes down is a stable reference — a `useCallback`/`useMemo` here or in
 * a hook beside this file — because `Sidebar`, `SessionColumn` and `SessionRow` are `React.memo`
 * (tests/component/appPropStability.test.tsx). Handlers every pane receives read the
 * workspace through the store when they run, not through a render's closure.
 */
function AppWindow({ detached, arrival, restored }: {
  detached: string | null
  arrival: TabTransfer | null
  restored: WindowLayoutReport | null
}): JSX.Element {
  const { notify, notifyError } = useNotifications()
  const workspace = useWorkspace()
  const dispatch = useWorkspaceDispatch()
  const store = useWorkspaceStore()
  const { layout, activeColumnId, openSessions, pending } = workspace
  const { addPending, setPendingTitle } = useWorkspaceFollowing()
  // Re-read when the settings dialog closes: they change only from there. Read before `useUiState`,
  // whose dismissed-Recent prune needs `recentSectionHours`.
  const { recentSectionHours, transcriptChat, reload: loadUiSettings } = useAppSettings()
  const uiState = useUiState(recentSectionHours)
  const { ui, updateUi: setUi, togglePin, unpin } = uiState
  const updateStatus = useUpdate()
  const dialogs = useDialogs()
  const { open: openDialog } = dialogs
  const { request: requestFolder, element: folderBrowserElement } = useFolderBrowserRequest(remoteHost())
  const columns = layout.panes
  useLaunchRestore({ restored, detached, arrival, selectedSessionId: ui.selectedSessionId })
  const { transferFor } = useWindowSync(detached)
  const [treeNonce, setTreeNonce] = useState(0)

  const activeColumn = columns.find((c) => c.id === activeColumnId) ?? columns[0]
  const pinnedKeys = useMemo(() => new Set(ui.pinned), [ui.pinned])
  const activeKey = activeColumn?.activeKey ?? null

  useRememberSelected(activeKey, pending, setUi)

  const { layoutRef, sidebarResize, bottomResize } = useWindowResizers(
    ui.sidebarWidth, ui.bottomHeight, uiState.setSidebarWidth, uiState.setBottomHeight,
  )
  const { layoutActions, layoutState, placeTarget, splitActiveTab, layoutMenuButton } =
    usePaneLayout(dispatch, layout, columns, openDialog)
  const starters = useSessionStarters({
    addPending, notify, notifyError, requestFolder, rememberCreatedWorktree: uiState.rememberCreatedWorktree,
  })
  const { forkSession } = starters
  const { startResume, confirmDelete, onResume, resumeAndWait } =
    useResumeCommands({ dispatch, notifyError, openDialog, unpin })
  const { openKeys, openKeySet, pendingTabInfo } = useOpenTabKeys(columns, pending)
  const columnHandlers = useColumnHandlers(columns, dispatch)

  const {
    onResumeClick, onRenameSession: onRenameSessionCb, onTogglePinKey, onForkKey, onTabDropped: onTabDroppedCb, onDetach: onDetachCb,
  } = useTabKeyHandlers({ dispatch, store, togglePin, forkSession, transferFor, onResume })
  const { onOpenSettings, titleOf } = useTabTitleAndSettings(openSessions, pendingTabInfo, openDialog)

  const [chrome] = useState(windowChrome)

  // Last on purpose (see useWindowReady).
  useWindowReady()

  return (
    <WindowContextProvider chat={transcriptChat} openDialog={openDialog} layoutActions={layoutActions} layoutState={layoutState}>
    <ThemeEffectsLayer />
    <div className="app-shell">
      <WindowHeader
        chrome={chrome}
        title={activeKey !== null ? titleOf(activeKey) : null}
        updateStatus={updateStatus}
        onOpenSettings={onOpenSettings}
      />
      <div
        ref={layoutRef}
        className="layout"
        data-detached={detached !== null}
        style={{ gridTemplateColumns: layoutGridColumns(ui.sidebarHidden, ui.sidebarWidth) }}
        data-sidebar-hidden={ui.sidebarHidden}
      >
        <AppSidebar
          uiState={uiState}
          dispatch={dispatch}
          treeNonce={treeNonce}
          activeKey={activeKey}
          pending={pending}
          openKeys={openKeys}
          forkSession={forkSession}
          onNewSession={starters.onNewSession}
          onNewSessionInPickedFolder={starters.onNewSessionInPickedFolder}
          resizerProps={sidebarResize.separatorProps}
        />
        <PaneColumns
          columns={columns}
          preset={layout.preset}
          activeColumnId={activeColumn?.id ?? ''}
          columnHandlers={columnHandlers}
          layoutMenuButton={layoutMenuButton}
          dispatch={dispatch}
          openSessions={openSessions}
          pendingTabInfo={pendingTabInfo}
          openKeySet={openKeySet}
          bottomHeight={ui.bottomHeight}
          bottomResizer={bottomResize.separatorProps}
          terminalListWidth={ui.terminalListWidth}
          onTerminalListWidth={uiState.setTerminalListWidth}
          onResume={onResumeClick}
          onResumeAsync={resumeAndWait}
          onRenameSession={onRenameSessionCb}
          onRenamePending={setPendingTitle}
          onSplitActive={splitActiveTab}
          transferFor={transferFor}
          pinnedKeys={pinnedKeys}
          onTogglePin={onTogglePinKey}
          onFork={onForkKey}
          onSessionStarted={starters.onSessionStarted}
          onTabDropped={onTabDroppedCb}
          onDetach={onDetachCb}
        />
        {folderBrowserElement}
        <DialogHost
          dialogs={dialogs}
          currentPreset={layout.preset}
          isTabOpen={(key) => findColumnWithTab(columns, key) !== null}
          onPlace={placeTarget}
          {...dialogHandlers({ startResume, confirmDelete, ...starters })}
          importWidth={ui.importDialogWidth}
          onImportWidthChange={uiState.setImportDialogWidth}
          onImported={() => { setTreeNonce((n) => n + 1) }}
          settingsUpdate={updateStatus}
          onSettingsClosed={loadUiSettings}
        />
      </div>
      <WindowFooter sidebarHidden={ui.sidebarHidden} titleOf={titleOf} onOpenSettings={onOpenSettings} />
    </div>
    </WindowContextProvider>
  )
}
