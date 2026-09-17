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

export interface LayoutActions {
  preset: PresetId
  place: (target: PlaceTarget, preset: PresetId, zone: number) => void
  apply: (preset: PresetId) => void
  /** Opens the picker at a point — for "Arrange…" in a context menu, which has no button to hover. */
  requestPicker: (target: PlaceTarget, at: { x: number; y: number }) => void
  /** Whether `key` is already open as a tab somewhere in this window, for the picker heading. */
  isOpen: (key: string) => boolean
}

/**
 * The window's layout, offered to the tab strips and the sidebar rows without threading it
 * through every component in between.
 */
export const LayoutContext = createContext<LayoutActions>({
  preset: 'single',
  place: () => {},
  apply: () => {},
  requestPicker: () => {},
  isOpen: () => false,
})

export function useLayoutActions(): LayoutActions {
  return useContext(LayoutContext)
}
