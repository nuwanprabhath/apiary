import { type Dispatch, type SetStateAction, useCallback, useEffect, useMemo, useState } from 'react'
import type { SessionNode } from '@shared/types'
import type { LibraryState } from '@shared/libraryState'
import { loadUiState, saveUiState, type ViewerUiState } from './uiState'
import { updateLibraryState, useLibraryState } from './libraryStateStore'
import { pruneDismissed, dismissRecent as dismissRecentAt } from './recentSessions'
import { moveBefore, type GroupState } from './groups'

/** This window's own state and the library's, read as one value; each half is written its own way. */
export type UiState = ViewerUiState & LibraryState

export interface UiStateActions {
  ui: UiState
  /** The raw updater of this window's own half, for the handful of call sites too specific to be
   *  worth a named action of their own (e.g. remembering the active session id). */
  updateUi: Dispatch<SetStateAction<ViewerUiState>>
  toggleSidebar: () => void
  togglePin: (session: SessionNode) => void
  unpin: (sessionId: string) => void
  setCollapsed: (next: Set<string>) => void
  setGroupState: (next: GroupState) => void
  reorderPinned: (id: string, beforeId: string) => void
  toggleAllWorktrees: (path: string) => void
  rememberCreatedWorktree: (folder: string, path: string) => void
  setPinnedCollapsed: (next: boolean) => void
  setRecentCollapsed: (next: boolean) => void
  dismissRecent: (session: SessionNode) => void
  setSidebarWidth: (width: number) => void
  setBottomHeight: (height: number) => void
  setTerminalListWidth: (width: number | null) => void
  setImportDialogWidth: (width: number) => void
}


const MAX_CREATED_WORKTREES = 50

/** The library's actions: each works out its patch from the latest state main sent, and sends it. */
function libraryActions(): Pick<UiStateActions,
  'togglePin' | 'unpin' | 'setGroupState' | 'reorderPinned' | 'toggleAllWorktrees' | 'rememberCreatedWorktree'
  | 'setPinnedCollapsed' | 'setRecentCollapsed' | 'dismissRecent'> {
  return {
    /**
     * Pins (or unpins) a session. Newly pinned ids go to the front, so the pinned section reads
     * most-recent-first rather than in whatever order the tree happened to hand them over.
     */
    togglePin: (session) => {
      updateLibraryState(({ pinned }) => ({
        pinned: pinned.includes(session.sessionId) ? pinned.filter((id) => id !== session.sessionId) : [session.sessionId, ...pinned],
      }))
    },
    /** Drops an id from the pinned list, used when the session behind it is removed from view. */
    unpin: (sessionId) => {
      updateLibraryState(({ pinned }) => (pinned.includes(sessionId) ? { pinned: pinned.filter((id) => id !== sessionId) } : {}))
    },
    setGroupState: (next) => {
      updateLibraryState(() => ({
        groups: next.groups, groupAssignments: next.assignments, groupsCollapsed: next.collapsed, folderOrder: next.folderOrder,
      }))
    },
    reorderPinned: (id, beforeId) => { updateLibraryState(({ pinned }) => ({ pinned: moveBefore(pinned, id, beforeId) })) },
    toggleAllWorktrees: (path) => {
      updateLibraryState(({ showAllWorktrees: all }) => ({
        showAllWorktrees: all.includes(path) ? all.filter((p) => p !== path) : [...all, path],
      }))
    },
    rememberCreatedWorktree: (folder, path) => {
      // The newest first, and only so many: once a session has run in one the tree finds it on its
      // own, and one since removed is simply not listed by git any more.
      updateLibraryState(({ createdWorktrees }) => ({
        createdWorktrees: [{ folder, path }, ...createdWorktrees.filter((w) => w.path !== path)].slice(0, MAX_CREATED_WORKTREES),
      }))
    },
    setPinnedCollapsed: (next) => { updateLibraryState(() => ({ pinnedCollapsed: next })) },
    setRecentCollapsed: (next) => { updateLibraryState(() => ({ recentCollapsed: next })) },
    dismissRecent: (session) => {
      updateLibraryState(({ dismissedRecent }) => ({ dismissedRecent: dismissRecentAt(dismissedRecent, session.sessionId, Date.now()) }))
    },
  }
}

/**
 * Owns this window's `ui` half (load, the synchronous save, narrow actions) and reads the library's
 * half from `libraryStateStore`, so the sidebar sees one value. A library action never sets local
 * state: it goes to main, and main's push (to every window, remote ones included) is what the
 * sidebar then shows.
 *
 * `recentSectionHours` is a parameter rather than read from this hook because it comes from
 * settings (`useAppSettings`, in `settingsStore.ts`), a sibling hook — passing it in keeps this hook from having an
 * opinion about where settings live.
 */
export function useUiState(recentSectionHours: number): UiStateActions {
  const [viewer, setViewer] = useState<ViewerUiState>(() => loadUiState())
  const library = useLibraryState()

  // Saved synchronously on every change: a debounce loses the last change before a quit or reload,
  // since a real quit tears the renderer down without a React unmount. Resize drags commit once,
  // on mouseup (see `setSidebarWidth`/`setBottomHeight`).
  useEffect(() => { saveUiState(viewer) }, [viewer])

  /**
   * Drops dismissals old enough that they could never hide a session again. A no-op prune returns
   * the same reference (see `pruneDismissed`), so this only writes when something is dropped.
   */
  useEffect(() => {
    const now = Date.now()
    if (pruneDismissed(library.dismissedRecent, now, recentSectionHours) === library.dismissedRecent) return
    updateLibraryState(({ dismissedRecent }) => ({ dismissedRecent: pruneDismissed(dismissedRecent, now, recentSectionHours) }))
  }, [library.dismissedRecent, recentSectionHours])

  const toggleSidebar = useCallback(() => {
    setViewer((prev) => ({ ...prev, sidebarHidden: !prev.sidebarHidden }))
  }, [])

  const setCollapsed = useCallback((next: Set<string>) => {
    setViewer((prev) => {
      const list = [...next].sort()
      if (list.join(' ') === [...prev.collapsed].sort().join(' ')) return prev
      return { ...prev, collapsed: list }
    })
  }, [])

  // Written only from a `mouseup` handler: React hears about a resize drag once, at the end.
  const setSidebarWidth = useCallback((width: number) => {
    setViewer((prev) => (prev.sidebarWidth === width ? prev : { ...prev, sidebarWidth: width }))
  }, [])
  const setBottomHeight = useCallback((height: number) => {
    setViewer((prev) => (prev.bottomHeight === height ? prev : { ...prev, bottomHeight: height }))
  }, [])

  const setTerminalListWidth = useCallback((width: number | null) => {
    setViewer((prev) => ({ ...prev, terminalListWidth: width }))
  }, [])
  const setImportDialogWidth = useCallback((width: number) => {
    setViewer((prev) => ({ ...prev, importDialogWidth: width }))
  }, [])

  const actions = useMemo(libraryActions, [])
  const ui = useMemo(() => ({ ...viewer, ...library }), [viewer, library])

  return {
    ui, updateUi: setViewer, toggleSidebar, setCollapsed,
    setSidebarWidth, setBottomHeight, setTerminalListWidth, setImportDialogWidth, ...actions,
  }
}
