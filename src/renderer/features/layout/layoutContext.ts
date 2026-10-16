import { createContext, use } from 'react'
import type { SessionNode } from '@shared/types'
import type { PresetId } from '../../state/layout'

/**
 * What a picker is placing: a tab already in the window, or a session from the sidebar.
 *
 * A tab target carries the pane it was picked from: the same key can be open in several panes,
 * and placing would otherwise act on the first one holding it.
 */
export type PlaceTarget = { kind: 'tab'; key: string; paneId: string } | { kind: 'session'; session: SessionNode }

/**
 * The callbacks a picker or row invokes. Kept apart from `LayoutState` so this context is
 * referentially stable across App renders (`isOpen` reads the open-key set through a ref): every
 * `SessionRow`, `FolderHeader` and tab strip reads it, and a value that changed every render
 * defeated `React.memo` on all of them.
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
  return use(LayoutContext)
}

export function useLayoutState(): LayoutState {
  return use(LayoutStateContext)
}
