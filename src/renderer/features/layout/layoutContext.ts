import { createContext, useContext } from 'react'
import type { SessionNode } from '@shared/types'
import type { PresetId } from './layout'

/**
 * What a picker is placing: a tab already in the window, or a session from the sidebar.
 *
 * A tab target carries the pane it was picked from: the same key can be open in more than one
 * pane at once (a split), and without knowing which one the picker was opened from, placing would
 * always act on the first pane holding that key rather than the one the user actually meant.
 */
export type PlaceTarget = { kind: 'tab'; key: string; paneId: string } | { kind: 'session'; session: SessionNode }

/**
 * The callbacks a picker or row invokes. Kept apart from `LayoutState` (UI-5) so a context holding
 * only these can be made referentially stable across App renders — `isOpen` reads the open-key set
 * through a ref rather than closing over `columns`, so it does not need a new identity when the
 * layout changes. Every `SessionRow`, `FolderHeader` and tab strip reads this context, so a value
 * that changed every render defeated `React.memo` on all of them (see UI-4).
 */
export interface LayoutActions {
  place: (target: PlaceTarget, preset: PresetId, zone: number) => void
  apply: (preset: PresetId) => void
  /** Opens the picker at a point — for "Arrange…" in a context menu, which has no button to hover. */
  requestPicker: (target: PlaceTarget, at: { x: number; y: number }) => void
  /** Whether `key` is already open as a tab somewhere in this window, for the picker heading. */
  isOpen: (key: string) => boolean
  startPaneMove: (paneId: string) => void
  endPaneMove: () => void
  /** Drops the moving pane onto `paneId`: the two trade places (see `swapPanes`). */
  dropPaneOn: (paneId: string) => void
}

/** The parts of the layout that genuinely change over time — consumers of these do re-render. */
export interface LayoutState {
  preset: PresetId
  /** How many panes the window has — a pane can only be moved onto another when there are two. */
  paneCount: number
  /** The pane being dragged by its tab bar, while one is: every other pane offers itself as a target. */
  movingPane: string | null
}

/**
 * The window's layout, offered to the tab strips and the sidebar rows without threading it
 * through every component in between.
 */
export const LayoutContext = createContext<LayoutActions>({
  place: () => {},
  apply: () => {},
  requestPicker: () => {},
  isOpen: () => false,
  startPaneMove: () => {},
  endPaneMove: () => {},
  dropPaneOn: () => {},
})

export const LayoutStateContext = createContext<LayoutState>({
  preset: 'single',
  paneCount: 1,
  movingPane: null,
})

export function useLayoutActions(): LayoutActions {
  return useContext(LayoutContext)
}

export function useLayoutState(): LayoutState {
  return useContext(LayoutStateContext)
}
