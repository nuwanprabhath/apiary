import { asSessionId, type PtyId, type SessionId } from '@shared/domain/ids'
import type { PendingTabInfo } from '../features/pane/paneTypes'
import { type JSX, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  type NewSessionInfo, type SessionNode, type TabTransfer,
  type WindowLayoutReport,
} from '@shared/types'
import { Sidebar } from '../features/sidebar/Sidebar'
import { SessionColumn } from '../features/pane/SessionColumn'
import { DialogHost } from '../features/dialogs/DialogHost'
import { DialogOpenContext, useDialogs } from '../features/dialogs/useDialogs'
import { StatusBar } from '../features/statusBar/StatusBar'
import { PetLayer, petsOut } from '../features/pets/PetLayer'
import { usePets } from '../features/pets/usePets'
import { findColumnWithTab, type OpenTab } from '../features/layout/columns'
import { presetDef, type PresetId } from '../features/layout/layout'
import {
  WorkspaceProvider, useWorkspace, useWorkspaceDispatch,
} from '../features/workspace/WorkspaceProvider'
import {
  LayoutContext, LayoutStateContext, type LayoutActions, type LayoutState, type PlaceTarget,
} from '../features/layout/layoutContext'
import { LayoutMenuButton } from '../features/layout/LayoutMenuButton'
import { PaneGrid } from '../features/layout/PaneGrid'
import { useResizeDrag } from '../features/layout/useResizeDrag'
import { PaneFiller } from '../features/pane/PaneFiller'
import { detachedKey, detachedTransfer, restoredWindow, windowChrome } from '../state/windowParams'
import { TitleBar } from '../features/titleBar/TitleBar'
import { useThemeState, useAppliedTheme } from '../theme/useTheme'
import { ThemeEffects } from '../theme/ThemeEffects'
import { useUpdate } from '../features/update/useUpdate'
import { useAppSettings } from '../state/useAppSettings'
import { useUiState } from '../state/useUiState'
import { useActiveTabs } from '../state/useActiveTabs'
import { treeStore } from '../state/treeStore'
import { useSessionFollowing } from '../features/workspace/useSessionFollowing'
import { usePendingSessions } from '../features/workspace/usePendingSessions'
import { usePtyLifecycle } from '../features/workspace/usePtyLifecycle'
import { useLaunchRestore } from '../features/workspace/useLaunchRestore'
import { useLayoutReporting } from '../features/workspace/useLayoutReporting'
import { useOpenSessionRows } from '../features/workspace/useOpenSessionRows'
import { useTabTransfer } from '../features/workspace/useTabTransfer'
import { ChatModeContext } from '../state/useChat'
import { useChatTakeover } from '../features/workspace/useChatTakeover'
import { UpdateBanner } from '../features/update/UpdateBanner'
import { useNotifications } from '../ui/notifications'
import { ErrorBoundary } from '../ui/ErrorBoundary'
import { describeError } from '../ui/errors'
import { SidebarIcon, LayoutIcon } from '../ui/icons'

/** How the toggle's shortcut is written on this platform — see the View menu in main/menu.ts. */
const SIDEBAR_SHORTCUT = navigator.userAgent.includes('Mac') ? '⌘B' : 'Ctrl+Shift+B'

const MIN_SIDEBAR_WIDTH = 200
const MAX_SIDEBAR_WIDTH = 600

// Floor keeps the toolbar plus a few rows of terminal usable; ceiling leaves the transcript
// area above it readable rather than squeezed to a sliver.
const MIN_BOTTOM_HEIGHT = 120
const MAX_BOTTOM_HEIGHT = 560

/** How far an arrow key moves a resizer (UI-27), matching PaneDividers' own keyboard step. */
const RESIZE_KEY_STEP_PX = 16

export function App(): JSX.Element {
  /**
   * The tab this window was torn off to show, or null for an ordinary window. Read once: a window
   * does not stop being a detached one, and re-reading the URL per render would be a lie waiting to
   * happen.
   */
  const [detached] = useState<string | null>(detachedKey)
  /** The rest of that tab — the processes it runs, which a torn-off window has to start out knowing
   *  (see TabTransfer). Read once, like `detached`. */
  const [arrival] = useState<TabTransfer | null>(detachedTransfer)
  /**
   * The previous run's record for this window, or null for an ordinary launch — see
   * `restoredWindow`. Read once, like `detached`/`arrival`. `restoredWindow` itself already returns
   * null for a detached window, so this and `detached` are mutually exclusive.
   */
  const [restored] = useState<WindowLayoutReport | null>(restoredWindow)
  return (
    <WorkspaceProvider restored={restored} arrival={arrival}>
      <AppWindow detached={detached} arrival={arrival} restored={restored} />
    </WorkspaceProvider>
  )
}

function AppWindow({ detached, arrival, restored }: {
  detached: string | null
  arrival: TabTransfer | null
  restored: WindowLayoutReport | null
}): JSX.Element {
  const { notify, notifyError } = useNotifications()
  const workspace = useWorkspace()
  const dispatch = useWorkspaceDispatch()
  const { layout, activeColumnId, openSessions, resumed, pending } = workspace
  // Pending-session reconciliation and rekeying: tabs follow the session their terminal is on.
  useSessionFollowing()
  const { addPending, setPendingTitle } = usePendingSessions()
  usePtyLifecycle()
  /**
   * Settings the renderer itself acts on. Re-read when the settings dialog closes rather than
   * subscribed to: these change only when someone changes them, and only from that one dialog.
   * Read before `useUiState` because its dismissed-Recent prune needs `recentSectionHours`.
   */
  const {
    revealActiveInSidebar, recentSectionEnabled, recentSectionHours,
    searchChatContent, searchSessionNotes, transcriptChat, reload: loadUiSettings,
  } = useAppSettings()
  const {
    ui, updateUi: setUi, toggleSidebar, togglePin, unpin, setCollapsed, setGroupState,
    reorderPinned, toggleAllWorktrees, rememberCreatedWorktree, setPinnedCollapsed, setRecentCollapsed, dismissRecent,
    setSidebarWidth, setBottomHeight, setTerminalListWidth, setImportDialogWidth,
  } = useUiState(recentSectionHours)
  /** The theme, applied by the hook itself; kept here for the effects layer. */
  const theme = useThemeState()
  /** What is on screen — a preview included — for the effects layer. */
  const applied = useAppliedTheme()
  // Assumed until main answers (a moment after start-up); only effects' frame rate depends on it.
  const [gpuCompositing, setGpuCompositing] = useState(true)
  useEffect(() => {
    // Background probe (UI-23): a failure leaves `gpuCompositing` at its assumed-true default,
    // which only affects the effects layer's frame rate — nothing the user asked for, and nothing
    // worth a toast over.
    void window.apiary.themeGpuCompositing().then(setGpuCompositing).catch(() => {})
  }, [])
  const updateStatus = useUpdate()
  const activeTabs = useActiveTabs()
  const pets = usePets()
  /** Every dialog's state; rendered by `DialogHost` below. */
  const dialogs = useDialogs()
  const { open: openDialog } = dialogs
  const columns = layout.panes
  // UI-3: read through a ref (rather than depending on `columns`) wherever an effect or a stable
  // callback needs the current columns without re-running when they change.
  const columnsRef = useRef(columns)
  columnsRef.current = columns
  useLaunchRestore({ restored, detached, arrival, selectedSessionId: ui.selectedSessionId })
  useLayoutReporting(detached)
  useOpenSessionRows()
  const { transferFor } = useTabTransfer()
  useChatTakeover()
  const [treeNonce, setTreeNonce] = useState(0)
  /** The `.layout` grid element — UI-6 writes the live sidebar width straight to its style during a drag. */
  const layoutRef = useRef<HTMLDivElement | null>(null)

  const activeColumn = columns.find((c) => c.id === activeColumnId) ?? columns[0]
  /**
   * Pinned ids as a set, for the tab menu's Pin/Unpin wording. Memoized (UI-1 step 1, stabilising
   * App's props): a fresh `Set` every render fed straight into `SessionColumn` defeated any memo a
   * later step put on it, even on a render that had nothing to do with pinning.
   */
  const pinnedKeys = useMemo(() => new Set(ui.pinned), [ui.pinned])
  const activeKey = activeColumn?.activeKey ?? null

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

  /** Closes a tab, dropping the column with it — unless it is the last one, which stays as an
   *  empty placeholder so the layout never collapses to nothing. */
  const closeSessionTab = useCallback((columnId: string, key: string) => {
    dispatch({ type: 'tab/close', columnId, key })
  }, [dispatch])

  // `ui`'s load, save-on-change, cross-window shared-state sync and the dismissed-Recent prune all
  // live in useUiState now (UI-1 step 1) — see its own comments for why the save is synchronous.
  useEffect(() => window.apiary.onToggleSidebar(toggleSidebar), [toggleSidebar])

  /**
   * Remembers which session is in front, so the next launch can reopen it (the restore effect
   * above consumes this). Deliberately never writes `null`: a pending tab has no session id worth
   * persisting, and blanking it while the app happens to have no tabs open would throw away the
   * restore target before the asynchronous restore has had a chance to use it.
   */
  useEffect(() => {
    if (activeKey === null || pending.has(activeKey)) return
    setUi((prev) => (prev.selectedSessionId === activeKey ? prev : { ...prev, selectedSessionId: activeKey }))
  }, [activeKey, pending, setUi])

  // Dragging the sidebar resizer updates ui.sidebarWidth once the drag ends (UI-6); it is
  // persisted like any other ui change, so it survives a relaunch. `useResizeDrag` owns the
  // `resizing-active` body class and the listeners.
  //
  // UI-6: the live value goes straight onto the grid element's style as a CSS custom property,
  // which the inline style below reads with `ui.sidebarWidth` as its fallback; React only hears
  // about the final width, once, on `mouseup`.
  const sidebarResize = useResizeDrag({
    axis: 'col',
    initial: () => ui.sidebarWidth,
    measure: (e) => Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, e.clientX)),
    onLive: (w) => { layoutRef.current?.style.setProperty('--drag-sidebar-width', `${String(w)}px`) },
    onEnd: (w) => {
      layoutRef.current?.style.removeProperty('--drag-sidebar-width')
      setSidebarWidth(w)
    },
  })

  // Same pattern for the bottom shell pane's height. Dragging up (decreasing clientY) should grow
  // the pane, so height is measured from the cursor to the bottom of the window. Set on the root,
  // not `layoutRef`: every open `SessionColumn`'s shell pane reads this, and panes are siblings.
  const bottomResize = useResizeDrag({
    axis: 'row',
    initial: () => ui.bottomHeight,
    measure: (e) => Math.min(MAX_BOTTOM_HEIGHT, Math.max(MIN_BOTTOM_HEIGHT, window.innerHeight - e.clientY)),
    onLive: (h) => { document.documentElement.style.setProperty('--drag-bottom-height', `${String(h)}px`) },
    onEnd: (h) => {
      document.documentElement.style.removeProperty('--drag-bottom-height')
      setBottomHeight(h)
    },
  })

  /**
   * The tab bar's split button: the active session opened again beside the current pane, keeping
   * the view it was on. It stays open where it was too, matching VS Code's split and the sidebar's
   * own split button. With four panes it opens in the next pane instead (see `openBeside`).
   */
  const splitActiveTab = useCallback((key: string) => {
    dispatch({ type: 'tab/split', key })
  }, [dispatch])

  const placeTarget = useCallback((target: PlaceTarget, preset: PresetId, zone: number) => {
    dispatch(target.kind === 'tab'
      ? { type: 'layout/place', key: target.key, preset, zone, paneId: target.paneId }
      : { type: 'layout/place', key: target.session.sessionId, preset, zone, session: target.session })
  }, [dispatch])

  const applyLayout = useCallback((preset: PresetId) => {
    dispatch({ type: 'layout/apply', preset })
  }, [dispatch])

  /** The pane being dragged onto another by its tab bar — see `swapPanes`. */
  const [movingPane, setMovingPane] = useState<string | null>(null)

  // UI-5: `isOpen` and `dropPaneOn` used to close over `columns`/`movingPane` by value, which gave
  // every render a new `layoutActions` object and defeated memoisation on every consumer (every
  // SessionRow, FolderHeader and tab strip). They now read the current value through a ref (see
  // `columnsRef` above), so the actions object below can be built once with useMemo([]) and never
  // change identity.
  const movingPaneRef = useRef(movingPane)
  movingPaneRef.current = movingPane

  const requestPicker = useCallback((target: PlaceTarget, at: { x: number; y: number }) => {
    openDialog({ kind: 'arrange', target, at })
  }, [openDialog])
  const isOpen = useCallback((key: string) => findColumnWithTab(columnsRef.current, key) !== null, [])
  const endPaneMove = useCallback(() => { setMovingPane(null) }, [])
  const dropPaneOn = useCallback((paneId: string) => {
    if (movingPaneRef.current !== null) dispatch({ type: 'layout/swap', from: movingPaneRef.current, to: paneId })
    setMovingPane(null)
  }, [dispatch])

  const layoutActions: LayoutActions = useMemo(() => ({
    place: placeTarget,
    apply: applyLayout,
    requestPicker,
    isOpen,
    startPaneMove: setMovingPane,
    endPaneMove,
    dropPaneOn,
  }), [placeTarget, applyLayout, requestPicker, isOpen, endPaneMove, dropPaneOn])

  const layoutState: LayoutState = useMemo(() => ({
    preset: layout.preset,
    paneCount: columns.length,
    movingPane,
  }), [layout.preset, columns.length, movingPane])

  // togglePin, unpin and setCollapsed now come from useUiState (UI-1 step 1).

  const onSelect = useCallback((session: SessionNode) => {
    openSessionTab(session, false)
  }, [openSessionTab])

  /** The sidebar's split button: same session, but in a column of its own beside the current one. */
  const onSplitSession = useCallback((session: SessionNode) => {
    openSessionTab(session, true)
  }, [openSessionTab])

  const onNewSession = useCallback(async (path: string) => {
    try {
      const [info, nodes] = await Promise.all([
        window.apiary.newSessionInProject(path),
        window.apiary.tree(),
      ])
      addPending(info, nodes)
    } catch (e) {
      notifyError(e, 'Could not start a new session')
    }
  }, [addPending, notifyError])

  /**
   * Forks a session from a tab or a sidebar row: a new conversation seeded with this one's, opened
   * beside it, leaving the original untouched.
   *
   * The fork has no session id yet — Claude mints one when it writes the JSONL — so this goes
   * through exactly the same pending-pty bookkeeping as starting a session from scratch, and the
   * `fork: …` title rides along as a `titleOverride` that is applied as a real rename the moment
   * the session resolves. Doing it that way rather than renaming afterwards means there is never a
   * moment where the fork and its original are two rows with the same name.
   */
  const forkSession = useCallback(async (sessionId: SessionId) => {
    try {
      const [info, nodes] = await Promise.all([
        window.apiary.forkSession(sessionId),
        window.apiary.tree(),
      ])
      addPending(info, nodes, { titleOverride: info.label, after: sessionId })
      notify({ message: `Forking — ${info.label}` })
    } catch (e) {
      notifyError(e, 'Could not fork this session')
    }
  }, [addPending, notify, notifyError])

  const startResume = useCallback(async (session: SessionNode) => {
    try {
      await window.apiary.resume(session.sessionId)
      dispatch({ type: 'resumed/add', key: session.sessionId })
      dispatch({ type: 'tab/showView', key: session.sessionId, view: 'terminal' })
    } catch (e) {
      notifyError(e, 'Could not resume this session')
    }
  }, [notifyError, dispatch])

  const confirmDelete = useCallback(async (target: SessionNode) => {
    try {
      await window.apiary.removeSession(target.sessionId)
      // A session that is no longer in the tree has nothing left to show, so close every tab
      // pointing at it rather than leaving a stale header behind in some column.
      dispatch({ type: 'session/removed', sessionId: target.sessionId })
      unpin(target.sessionId)
    } catch (e) {
      notifyError(e, 'Could not remove this session')
    }
  }, [notifyError, unpin, dispatch])

  const onResume = useCallback(async (session: SessionNode) => {
    if (resumed.has(session.sessionId)) {
      dispatch({ type: 'tab/showView', key: session.sessionId, view: 'terminal' })
      return
    }
    try {
      const existing = await window.apiary.checkConflict(session.sessionId)
      if (existing !== null) { openDialog({ kind: 'conflict', session, conflict: existing }); return }
      await startResume(session)
    } catch (e) {
      // User-initiated (UI-23): clicking a session is the one reason this runs, so a failure here
      // — main's own callers (`onResumeClick`) `void` this — is worth naming, not the generic
      // "Unexpected error" the window-level net would otherwise print.
      notifyError(e, 'Could not resume this session')
    }
  }, [resumed, startResume, dispatch, notifyError, openDialog])

  /**
   * Resume for the composer: resolves only once there is a process to type into.
   *
   * Distinct from `onResume` above, which is free to hand off to the conflict dialog and return
   * having started nothing. A composer that sent as soon as *that* resolved would be typing into a
   * session the user has not yet agreed to open. Here a conflict is a refusal, stated as one.
   */
  const resumeAndWait = useCallback(async (session: SessionNode) => {
    if (resumed.has(session.sessionId)) return
    const existing = await window.apiary.checkConflict(session.sessionId)
    if (existing !== null) {
      openDialog({ kind: 'conflict', session, conflict: existing })
      throw new Error('This session is already running elsewhere — choose how to open it first.')
    }
    await window.apiary.resume(session.sessionId)
    dispatch({ type: 'resumed/add', key: session.sessionId })
    dispatch({ type: 'tab/showView', key: session.sessionId, view: 'terminal' })
  }, [resumed, dispatch, openDialog])

  /** Every session id currently open in some column, so the sidebar can list only the pending
   *  sessions that aren't already reachable as a tab. Memoized: two effects below depend on it, and
   *  a fresh Set every render would restart their debounce timers on every render instead of only
   *  when the open tabs actually change. */
  const openKeys = useMemo(
    () => new Set(columns.flatMap((c) => c.tabs.map((t) => t.key))),
    [columns],
  )

  const openKeysSignature = [...openKeys].sort((a, b) => a.localeCompare(b)).join(' ')

  // Memoized (UI-1 step 1): fed straight into every SessionColumn and PaneFiller, so a fresh Map
  // here on every render defeated their prop stability regardless of anything else done to it.
  const pendingTabInfo = useMemo(() => new Map<string, PendingTabInfo>(
    [...pending.values()].map((info) => [
      info.ptyId,
      { ptyId: info.ptyId, cwd: info.cwd, label: info.titleOverride ?? info.label },
    ]),
  ), [pending])

  // Rebuilt only when the set of open keys actually changes, so PaneFiller's own memo (keyed on
  // this set) isn't invalidated by every unrelated render of App.
  const openKeySet = useMemo(
    () => new Set(openKeysSignature === '' ? [] : openKeysSignature.split(' ')),
    [openKeysSignature],
  )

  // --- UI-1 step 1: stabilise what App passes to Sidebar and SessionColumn -----------------------
  // Everything below is a `useCallback`/`useMemo` wrapper around a handler or a derived value that
  // used to be built inline in the JSX (a fresh closure, object or array every render). None of
  // them change behaviour — each closes over exactly what the inline version did — the point is
  // only that a render this state has nothing to do with (a theme change, an unrelated notification)
  // now hands Sidebar/SessionColumn back the *same* function and object references, which a later
  // step's `React.memo` can actually make use of. See tests/component/appPropStability.test.tsx.

  const onStartBottomResize = bottomResize.start

  /** The bottom shell pane's resizer keyboard alternative (UI-27) — steps `bottomHeight` directly
   *  rather than going through the drag machinery above, which has no meaning for a key press. */
  const onBottomHeightStep = useCallback((delta: number) => {
    setBottomHeight(Math.min(MAX_BOTTOM_HEIGHT, Math.max(MIN_BOTTOM_HEIGHT, ui.bottomHeight + delta)))
  }, [ui.bottomHeight, setBottomHeight])

  const onResumeClick = useCallback((session: SessionNode) => { void onResume(session) }, [onResume])

  const onRenameSessionCb = useCallback((session: SessionNode, title: string) => {
    dispatch({ type: 'openSessions/set', session: { ...session, title } })
    void window.apiary.renameSession(session.sessionId, title).catch((e: unknown) => {
      notifyError(e, 'Could not rename the session')
    })
  }, [notifyError, dispatch])

  const onTogglePinKey = useCallback((key: string) => {
    // A pending tab has no session row to pin yet, so this simply does nothing for it rather than
    // pinning an id that will be replaced the moment it resolves.
    const session = openSessions.get(key)
    if (session) togglePin(session)
  }, [openSessions, togglePin])

  const onForkKey = useCallback((key: string) => { void forkSession(asSessionId(key)) }, [forkSession])

  const onSessionStartedCb = useCallback((info: NewSessionInfo) => {
    // A session started from the worktree-conflict dialog is a new session like any other: it has
    // no id until Claude writes one, so it goes through the same pending bookkeeping rather than a
    // path of its own.
    void treeStore.current().then((nodes) => { addPending(info, nodes) })
      .catch((e: unknown) => { notifyError(e, 'Could not open that session') })
  }, [addPending, notifyError])

  const onTabDroppedCb = useCallback((key: string, at: { x: number; y: number }) => {
    void window.apiary.tabDropped(transferFor(key), at).catch((e: unknown) => {
      notifyError(e, 'Could not move this tab')
    })
  }, [transferFor, notifyError])

  const onDetachCb = useCallback((key: string, at: { x: number; y: number }) => {
    void window.apiary.tabDetach(transferFor(key), at).catch((e: unknown) => {
      notifyError(e, 'Could not open this session in a new window')
    })
  }, [transferFor, notifyError])

  /** The window-layout button shown at the top-right pane — same element every render (`applyLayout`
   *  is already stable), rather than a fresh one built inline for whichever column happens to sit
   *  there. */
  const layoutMenuButton = useMemo(() => (
    <LayoutMenuButton
      className="session-tab-split window-layout-button"
      testId="window-layout-button"
      title="Layout"
      ariaLabel="Change layout"
      heading="Layout"
      mode="layout"
      onPick={(preset) => { applyLayout(preset) }}
    >
      <LayoutIcon />
    </LayoutMenuButton>
  ), [applyLayout])

  /**
   * Per-column handlers that used to be built inline inside `columns.map(...)` — a fresh closure
   * over `column.id` for every column on every render. Rebuilt only when the set of open column ids
   * changes (a split, a close, a layout change), not on a render that leaves the columns alone, by
   * keying the memo on the column ids themselves rather than the `columns` array reference (which
   * itself changes on any tab open/close inside an existing column).
   */
  const columnIdsSignature = columns.map((c) => c.id).join(' ')
  const columnHandlers = useMemo(() => {
    const map = new Map<string, {
      onFocus: () => void
      onActivateTab: (key: string) => void
      onCloseTab: (key: string) => void
      onSetView: (key: string, view: OpenTab['view']) => void
      onReorderTab: (key: string, toIndex: number, transfer: TabTransfer | null) => void
    }>()
    for (const columnId of columnIdsSignature === '' ? [] : columnIdsSignature.split(' ')) {
      map.set(columnId, {
        onFocus: () => { dispatch({ type: 'column/focus', columnId }) },
        onActivateTab: (key) => { dispatch({ type: 'tab/activate', columnId, key }) },
        onCloseTab: (key) => { closeSessionTab(columnId, key) },
        onSetView: (key, view) => { dispatch({ type: 'tab/setView', columnId, key, view }) },
        onReorderTab: (key, toIndex, transfer) => {
          // Not open anywhere in this window: it came from another one, whose drop the platform
          // delivered here rather than as a `dragend` over nothing (X11 does this). Moving it
          // within this window would silently do nothing — the reported "dragging it back to the
          // main window does nothing" — so ask the main process to hand it over instead.
          if (!openKeys.has(key)) {
            if (transfer !== null) {
              void window.apiary.tabAdoptHere(transfer).catch((e: unknown) => {
                notifyError(e, 'Could not move this tab')
              })
            }
            return
          }
          // The tab may have been dragged in from another column, so this cannot be a change to
          // this column alone — a move has to leave the column it came from at the same time, or
          // the same session ends up open twice.
          dispatch({ type: 'tab/move', key, toColumnId: columnId, toIndex })
        },
      })
    }
    return map
    // openKeys is read inside onReorderTab through the closure above; it is safe as a dependency
    // (rather than a ref) because reordering already only fires from a user drag, never from a
    // background tick, so recomputing this map when it changes costs nothing observable.
  }, [columnIdsSignature, dispatch, closeSessionTab, openKeys, notifyError])

  /** Sidebar's `groupState` — one object rather than four scalars, kept stable across renders that
   *  don't touch grouping so it never busts a memo below Sidebar on its own. */
  const sidebarGroupState = useMemo(() => ({
    groups: ui.groups,
    assignments: ui.groupAssignments,
    collapsed: ui.groupsCollapsed,
    folderOrder: ui.folderOrder,
  }), [ui.groups, ui.groupAssignments, ui.groupsCollapsed, ui.folderOrder])

  const sidebarCollapsed = useMemo(() => new Set(ui.collapsed), [ui.collapsed])

  /** Pending new sessions not already reachable as a tab anywhere — see Sidebar's own `pending`
   *  prop doc. Recomputed only when what it actually depends on changes. */
  const sidebarPending = useMemo(
    () => [...pending.values()]
      .filter((p) => !openKeys.has(p.ptyId) && !activeTabs.some((t) => t.key === p.ptyId))
      .map((p) => ({ ptyId: p.ptyId, label: p.titleOverride ?? p.label, cwd: p.cwd })),
    [pending, openKeys, activeTabs],
  )

  const onForkSessionSidebar = useCallback((sessionId: SessionId) => { void forkSession(sessionId) }, [forkSession])

  const onNewSessionSidebar = useCallback((path: string) => { void onNewSession(path) }, [onNewSession])
  /** Resolves the new session's folder, so the sidebar can file it into the group it came from. */
  const onNewSessionInPickedFolder = useCallback(async (): Promise<string | null> => {
    try {
      const info = await window.apiary.newSessionInPickedFolder()
      if (info === null) return null
      addPending(info, await window.apiary.tree())
      return info.cwd
    } catch (e) {
      notifyError(e, 'Could not start a new session')
      return null
    }
  }, [addPending, notifyError])
  const onWorktreeCreated = useCallback(async (info: NewSessionInfo, folder: string) => {
    rememberCreatedWorktree(folder, info.cwd)
    notify({ message: `Worktree created at ${info.cwd} — starting Claude there` })
    try {
      addPending(info, await window.apiary.tree())
    } catch (e) {
      notifyError(e, 'Could not open the new worktree\'s session')
    }
  }, [addPending, notify, notifyError, rememberCreatedWorktree])

  const onOpenSettings = useCallback((section: string) => { openDialog({ kind: 'settings', section }) }, [openDialog])

  const onStopPendingSidebar = useCallback((ptyId: PtyId) => { window.apiary.ptyKill(ptyId) }, [])

  const onSelectPendingSidebar = useCallback((ptyId: PtyId) => {
    dispatch({ type: 'tab/open', key: ptyId })
  }, [dispatch])

  const onFocusTabSidebar = useCallback((w: number, key: string) => { void window.apiary.focusTab(w, key) }, [])

  // The pets' hourly lines mention what the open sessions are about — by title only.
  const titleOf = useCallback((key: string) => openSessions.get(key)?.title ?? pendingTabInfo.get(key)?.label ?? null, [openSessions, pendingTabInfo])

  // Read once: it decides the layout from the first paint, and does not change for this window.
  const [chrome] = useState(windowChrome)
  // The title bar names what is in front, as an editor's names the open file.
  const windowTitle = activeKey !== null
    ? openSessions.get(activeKey)?.title ?? pendingTabInfo.get(activeKey)?.label ?? null
    : null

  // Declared after every hook above on purpose: effects run children first, then in declaration
  // order, so by the time this one runs every IPC subscription this window makes (`onTabAdopt`
  // included) is in place. The e2e harness waits for it before treating a new window as one that
  // can be handed a tab — under React 19 a window could be "loaded" and still not listening.
  useEffect(() => {
    document.documentElement.dataset.ready = 'true'
  }, [])

  return (
    <ChatModeContext value={transcriptChat}>
    <DialogOpenContext value={openDialog}>
    <LayoutContext value={layoutActions}>
    <LayoutStateContext value={layoutState}>
    <ThemeEffects
      effects={applied?.effects ?? []}
      animated={theme.options.animated}
      intensity={theme.options.intensity}
      glass={applied?.material.kind === 'glass' ? applied.material : null}
      lowPower={!gpuCompositing}
    />
    <div className="app-shell">
      <TitleBar chrome={chrome} title={windowTitle !== null ? `${windowTitle} — Apiary` : 'Apiary'} />
      {updateStatus !== null && (
        <UpdateBanner status={updateStatus} onOpenSettings={() => { onOpenSettings('updates') }} />
      )}
      <div
        ref={layoutRef}
        className="layout"
        data-detached={detached !== null}
        style={{
          // The same for a torn-off window as any other: it keeps the sidebar (hidden to the rail
          // by default, see uiState), so the library is never out of reach from it.
          //
          // UI-6: `var(--drag-sidebar-width, …)` reads the live value the drag effect above writes
          // straight onto this element during a resize, falling back to the committed
          // `ui.sidebarWidth` the rest of the time (including the instant after `mouseup`, once the
          // property is removed and before `setUi`'s render lands — both name the same width).
          gridTemplateColumns: ui.sidebarHidden
            ? 'var(--sidebar-rail-width) 1fr'
            : `var(--drag-sidebar-width, ${String(ui.sidebarWidth)}px) max(var(--panel-gap), 4px) 1fr`,
        }}
        data-sidebar-hidden={ui.sidebarHidden}
      >
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
      {(
      <Sidebar
        key={treeNonce}
        // Hidden, not unmounted, so the search typed into it and where it was scrolled to are
        // still there when it comes back.
        hidden={ui.sidebarHidden}
        onHide={toggleSidebar}
        hideTitle={`Hide sidebar (${SIDEBAR_SHORTCUT})`}
        onForkSession={onForkSessionSidebar}
        selectedId={activeKey}
        revealId={revealActiveInSidebar ? activeKey : null}
        searchChatContent={searchChatContent}
        searchSessionNotes={searchSessionNotes}
        groupState={sidebarGroupState}
        onGroupStateChange={setGroupState}
        onReorderPinned={reorderPinned}
        showAllWorktrees={ui.showAllWorktrees}
        createdWorktrees={ui.createdWorktrees}
        onToggleAllWorktrees={toggleAllWorktrees}
        onSelect={onSelect}
        onSplitSession={onSplitSession}
        collapsed={sidebarCollapsed}
        onCollapsedChange={setCollapsed}
        onNewSession={onNewSessionSidebar}
        onNewSessionInPickedFolder={onNewSessionInPickedFolder}
        pinned={ui.pinned}
        onTogglePin={togglePin}
        pinnedCollapsed={ui.pinnedCollapsed}
        onPinnedCollapsedChange={setPinnedCollapsed}
        recentSectionEnabled={recentSectionEnabled}
        recentSectionHours={recentSectionHours}
        dismissedRecent={ui.dismissedRecent}
        recentCollapsed={ui.recentCollapsed}
        onRecentCollapsedChange={setRecentCollapsed}
        onDismissRecent={dismissRecent}
        pending={sidebarPending}
        onStopPending={onStopPendingSidebar}
        onSelectPending={onSelectPendingSidebar}
        activeTabs={activeTabs}
        onFocusTab={onFocusTabSidebar}
      />
      )}

      {!ui.sidebarHidden && (
        <div
          className="sidebar-resizer"
          data-testid="sidebar-resizer"
          // UI-27: was a mouse-only drag handle with `aria-hidden` never even set (so a screen
          // reader announced an unlabelled, inert div) and no keyboard alternative at all.
          role="separator"
          aria-orientation="vertical"
          aria-valuemin={MIN_SIDEBAR_WIDTH}
          aria-valuemax={MAX_SIDEBAR_WIDTH}
          aria-valuenow={ui.sidebarWidth}
          aria-label="Resize the sidebar"
          tabIndex={0}
          onMouseDown={(e) => { e.preventDefault(); sidebarResize.start() }}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
            e.preventDefault()
            const delta = e.key === 'ArrowRight' ? RESIZE_KEY_STEP_PX : -RESIZE_KEY_STEP_PX
            setSidebarWidth(Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, ui.sidebarWidth + delta)))
          }}
        />
      )}

      <PaneGrid preset={layout.preset}>
        {columns.map((column, index) => {
          // columnHandlers is built from exactly these columns' ids (see its own comment above),
          // so this is always present — the `!` records that invariant rather than papering over
          // a real possibility of `undefined`.
          const handlers = columnHandlers.get(column.id)!
          return (
          // Per pane, not just once around the whole app: a pane whose session renders badly (a
          // transcript with something unexpected in it, say) should fail inside its own zone and
          // leave the sidebar and the other panes working, rather than blanking the window.
          <ErrorBoundary
            key={column.id}
            label="This session"
            onError={(thrown, componentStack) => {
              const { message, detail } = describeError(thrown)
              notify({
                kind: 'error',
                message: `This session could not be displayed: ${message}`,
                detail: [detail, componentStack].filter((t) => t !== null && t !== '').join('\n'),
              })
            }}
            style={{ gridArea: `z${String(index + 1)}` }}
          >
          <SessionColumn
            gridArea={`z${String(index + 1)}`}
            column={column}
            sessions={openSessions}
            pending={pendingTabInfo}
            resumed={resumed}
            bottomHeight={ui.bottomHeight}
            onStartBottomResize={onStartBottomResize}
            onBottomHeightStep={onBottomHeightStep}
            terminalListWidth={ui.terminalListWidth}
            onTerminalListWidth={setTerminalListWidth}
            isActive={column.id === activeColumn?.id}
            onFocus={handlers.onFocus}
            onActivateTab={handlers.onActivateTab}
            onCloseTab={handlers.onCloseTab}
            onSetView={handlers.onSetView}
            onResume={onResumeClick}
            onResumeAsync={resumeAndWait}
            onRenameSession={onRenameSessionCb}
            onRenamePending={setPendingTitle}
            onSplitActive={splitActiveTab}
            transferFor={transferFor}
            onReorderTab={handlers.onReorderTab}
            pinnedKeys={pinnedKeys}
            onTogglePin={onTogglePinKey}
            onFork={onForkKey}
            onSessionStarted={onSessionStartedCb}
            onTabDropped={onTabDroppedCb}
            onDetach={onDetachCb}
            layoutButton={index === presetDef(layout.preset).topRight ? layoutMenuButton : undefined}
            emptyContent={column.placeholder === true ? (
              <PaneFiller
                openTabs={columns
                  // A pane's only tab is excluded: moving it would empty that pane and step the
                  // layout down, so the click would look like it did nothing. The picker can still
                  // move it deliberately.
                  .filter((c) => c.id !== column.id && c.tabs.length > 1)
                  .flatMap((c) => c.tabs)
                  .map((t) => ({
                    key: t.key,
                    label: openSessions.get(t.key)?.title ?? pendingTabInfo.get(t.key)?.label ?? t.key,
                  }))}
                exclude={openKeySet}
                onMoveHere={(key) => { dispatch({ type: 'tab/move', key, toColumnId: column.id, toIndex: 0 }) }}
                onOpenHere={(session) => {
                  dispatch({ type: 'openSessions/set', session })
                  dispatch({ type: 'tab/activate', columnId: column.id, key: session.sessionId })
                }}
                onClosePane={() => { dispatch({ type: 'layout/closePane', columnId: column.id }) }}
              />
            ) : undefined}
          />
          </ErrorBoundary>
          )
        })}
      </PaneGrid>

      <DialogHost
        dialogs={dialogs}
        currentPreset={layout.preset}
        isTabOpen={(key) => findColumnWithTab(columns, key) !== null}
        onPlace={placeTarget}
        onFork={(id) => { void forkSession(asSessionId(id)) }}
        onOpenAnyway={(session) => { void startResume(session) }}
        onConfirmDelete={(session) => { void confirmDelete(session) }}
        onWorktreeCreated={(info, folder) => { void onWorktreeCreated(info, folder) }}
        importWidth={ui.importDialogWidth}
        onImportWidthChange={setImportDialogWidth}
        onImported={() => { setTreeNonce((n) => n + 1) }}
        settingsUpdate={updateStatus}
        onSettingsClosed={loadUiSettings}
      />
      </div>
      {/* Part of the window, not a card in the pane grid: the whole width under the sidebar and
       *  the panes alike, as VS Code's status bar is. */}
      <StatusBar onOpenSettings={onOpenSettings} keep={petsOut(pets)} />
      <PetLayer state={pets} sidebarHidden={ui.sidebarHidden} tabs={activeTabs} titleOf={titleOf} onOpenSettings={onOpenSettings} />
    </div>
    </LayoutStateContext>
    </LayoutContext>
    </DialogOpenContext>
    </ChatModeContext>
  )
}
