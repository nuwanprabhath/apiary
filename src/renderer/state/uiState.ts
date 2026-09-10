export interface UiState {
  /**
   * Paths of folders the user has deliberately collapsed. Anything NOT in this list is open,
   * including a folder that has never been seen before — so a newly discovered folder opens by
   * default, and a folder the user closed stays closed across remounts and restarts, without
   * needing any separate "have we seen this path before" bookkeeping.
   */
  collapsed: string[]
  /**
   * Session ids the user has pinned, newest first, shown in their own section above the tree.
   * Ids of sessions that have since been removed are harmless: the sidebar renders only the ones
   * it can still find in the tree, so a stale id costs nothing and comes back if the session is
   * ever re-imported.
   */
  pinned: string[]
  /** Whether the pinned section itself is collapsed. */
  pinnedCollapsed: boolean
  selectedSessionId: string | null
  sidebarWidth: number
  bottomHeight: number
  /** Width of the import dialog, which is draggable because session titles get long. */
  importDialogWidth: number
}

const KEY = 'apiary.ui'

export const DEFAULT_UI_STATE: UiState = {
  collapsed: [],
  pinned: [],
  pinnedCollapsed: false,
  selectedSessionId: null,
  sidebarWidth: 320,
  bottomHeight: 200,
  importDialogWidth: 620,
}

export function loadUiState(): UiState {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_UI_STATE
    return { ...DEFAULT_UI_STATE, ...(JSON.parse(raw) as Partial<UiState>) }
  } catch {
    return DEFAULT_UI_STATE
  }
}

export function saveUiState(state: UiState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // Storage can be unavailable; the app works fine without persistence.
  }
}
