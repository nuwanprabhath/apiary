import { type Dispatch, type SetStateAction, useCallback, useEffect, useState } from 'react'
import type { SessionNode } from '@shared/types'
import {
  loadUiState, saveUiState, subscribeSharedUiState, type UiState,
} from './uiState'
import { pruneDismissed, dismissRecent as dismissRecentAt } from '../features/sidebar/model/recentSessions'
import { moveBefore, type GroupState } from '../features/sidebar/model/groups'

export interface UiStateActions {
  ui: UiState
  /** The raw updater, for the handful of call sites too specific to be worth a named action of
   *  their own (e.g. remembering the active session id) — every action below is built on it. */
  updateUi: Dispatch<SetStateAction<UiState>>
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
/**
 * Owns the per-window/shared `ui` blob: load, the synchronous save, cross-window shared-state
 * sync, and the dismissed-Recent prune — plus narrow actions for every place App.tsx mutated it
 * ad hoc. Ports App.tsx 129, 312–321, 399–408, 913–935 verbatim.
 *
 * `recentSectionHours` is a parameter rather than read from this hook because it comes from
 * settings (`useAppSettings`, in `settingsStore.ts`), a sibling hook — passing it in keeps this hook from having an
 * opinion about where settings live.
 */
export function useUiState(recentSectionHours: number): UiStateActions {
  const [ui, setUi] = useState<UiState>(() => loadUiState())

  // Saved on every `ui` change, synchronously. A debounce was tried (UI-6) and lost the last
  // change before a quit or reload: a real quit tears the renderer down without a React unmount,
  // so a pending timer simply never fires. The expensive case it was meant for — a drag writing on
  // every mousemove — is gone at the source: resize drags commit `ui` once, on mouseup (see
  // `setSidebarWidth`/`setBottomHeight`, called only from a `mouseup` handler).
  useEffect(() => { saveUiState(ui) }, [ui])

  // Pins and groups belong to the library rather than to this window, so a change made in another
  // window lands here as it happens instead of at the next launch.
  useEffect(() => subscribeSharedUiState((shared) => {
    setUi((prev) => ({ ...prev, ...shared }))
  }), [])

  /**
   * Drops dismissals old enough that they could never hide a session again, so the shared map does
   * not grow without bound across months of use. Re-checked whenever the window is open and either
   * input changes; a no-op prune returns the same reference (see `pruneDismissed`), so this only
   * writes shared state when there is actually something to drop.
   */
  useEffect(() => {
    setUi((prev) => {
      const pruned = pruneDismissed(prev.dismissedRecent, Date.now(), recentSectionHours)
      return pruned === prev.dismissedRecent ? prev : { ...prev, dismissedRecent: pruned }
    })
  }, [recentSectionHours])

  const toggleSidebar = useCallback(() => {
    setUi((prev) => ({ ...prev, sidebarHidden: !prev.sidebarHidden }))
  }, [])

  /**
   * Pins (or unpins) a session. Newly pinned ids go to the front, so the pinned section reads
   * most-recent-first rather than in whatever order the tree happened to hand them over.
   */
  const togglePin = useCallback((session: SessionNode) => {
    setUi((prev) => ({
      ...prev,
      pinned: prev.pinned.includes(session.sessionId)
        ? prev.pinned.filter((id) => id !== session.sessionId)
        : [session.sessionId, ...prev.pinned],
    }))
  }, [])

  /** Drops an id from the pinned list, used when the session behind it is removed from view. */
  const unpin = useCallback((sessionId: string) => {
    setUi((prev) => (prev.pinned.includes(sessionId)
      ? { ...prev, pinned: prev.pinned.filter((id) => id !== sessionId) }
      : prev))
  }, [])

  const setCollapsed = useCallback((next: Set<string>) => {
    setUi((prev) => {
      const list = [...next].sort()
      if (list.join(' ') === [...prev.collapsed].sort().join(' ')) return prev
      return { ...prev, collapsed: list }
    })
  }, [])

  const setGroupState = useCallback((next: GroupState) => {
    setUi((prev) => ({
      ...prev,
      groups: next.groups,
      groupAssignments: next.assignments,
      groupsCollapsed: next.collapsed,
      folderOrder: next.folderOrder,
    }))
  }, [])

  const reorderPinned = useCallback((id: string, beforeId: string) => {
    setUi((prev) => ({ ...prev, pinned: moveBefore(prev.pinned, id, beforeId) }))
  }, [])

  const toggleAllWorktrees = useCallback((path: string) => {
    setUi((prev) => ({
      ...prev,
      showAllWorktrees: prev.showAllWorktrees.includes(path)
        ? prev.showAllWorktrees.filter((p) => p !== path)
        : [...prev.showAllWorktrees, path],
    }))
  }, [])

  const rememberCreatedWorktree = useCallback((folder: string, path: string) => {
    setUi((prev) => ({
      ...prev,
      // The newest first, and only so many: once a session has run in one the tree finds it on its
      // own, and one since removed is simply not listed by git any more.
      createdWorktrees: [{ folder, path }, ...prev.createdWorktrees.filter((w) => w.path !== path)].slice(0, MAX_CREATED_WORKTREES),
    }))
  }, [])

  const setPinnedCollapsed = useCallback((next: boolean) => {
    setUi((prev) => ({ ...prev, pinnedCollapsed: next }))
  }, [])

  const setRecentCollapsed = useCallback((next: boolean) => {
    setUi((prev) => ({ ...prev, recentCollapsed: next }))
  }, [])

  const dismissRecent = useCallback((session: SessionNode) => {
    setUi((prev) => ({
      ...prev,
      dismissedRecent: dismissRecentAt(prev.dismissedRecent, session.sessionId, Date.now()),
    }))
  }, [])

  // Written only from a `mouseup` handler (see CLAUDE.md/UI-6): React hears about a resize drag
  // once, at the end, not on every `mousemove`.
  const setSidebarWidth = useCallback((width: number) => {
    setUi((prev) => (prev.sidebarWidth === width ? prev : { ...prev, sidebarWidth: width }))
  }, [])
  const setBottomHeight = useCallback((height: number) => {
    setUi((prev) => (prev.bottomHeight === height ? prev : { ...prev, bottomHeight: height }))
  }, [])

  const setTerminalListWidth = useCallback((width: number | null) => {
    setUi((prev) => ({ ...prev, terminalListWidth: width }))
  }, [])
  const setImportDialogWidth = useCallback((width: number) => {
    setUi((prev) => ({ ...prev, importDialogWidth: width }))
  }, [])

  return {
    ui, updateUi: setUi, toggleSidebar, togglePin, unpin, setCollapsed, setGroupState, reorderPinned,
    toggleAllWorktrees, rememberCreatedWorktree, setPinnedCollapsed, setRecentCollapsed, dismissRecent,
    setSidebarWidth, setBottomHeight, setTerminalListWidth, setImportDialogWidth,
  }
}
