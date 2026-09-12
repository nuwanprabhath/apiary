import type { SessionGroup } from './groups'

export type { SessionGroup }

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
  /**
   * Top-level folder groups, in display order — the user's own headings for the sidebar, so months
   * of folders can be filed away rather than scrolled past. Modelled on the simple-worktrees VS
   * Code extension: a flat, ordered list of named groups, with folders assigned to them by path.
   */
  groups: SessionGroup[]
  /** Project path → group id. A path with no entry (or a stale one) is simply ungrouped. */
  groupAssignments: Record<string, string>
  /** Ids of groups the user has collapsed; like `collapsed`, absence means open. */
  groupsCollapsed: string[]
  /**
   * Project paths in the order the user dragged them into, outermost level only. Paths missing
   * from this list sort after the ones in it, so a newly discovered folder appears at the bottom
   * rather than silently jumping into the middle of an arrangement someone made deliberately.
   */
  folderOrder: string[]
  selectedSessionId: string | null
  sidebarWidth: number
  bottomHeight: number
  /** Width of the import dialog, which is draggable because session titles get long. */
  importDialogWidth: number
}

/**
 * What belongs to the window, and what belongs to the user.
 *
 * These are two different lifetimes wearing one type. The tabs, the column widths, the folder you
 * happen to have open — those are this window's. The pinned sessions, the groups and the order
 * folders are arranged in are the *library's*: they describe how the user has organised their
 * sessions, and a second window that opened onto the same sessions with none of that organisation
 * is not a fresh workspace, it is the same workspace with the shelves emptied.
 *
 * So the shared half lives under one unsuffixed key that every window reads and writes, and the
 * per-window half under a key carrying the window number. Both are localStorage, which every
 * window shares because they share an origin — which is also what makes `storage` events a live
 * channel between them (see `subscribeSharedUiState`).
 */
const SHARED_FIELDS = [
  'pinned', 'pinnedCollapsed', 'groups', 'groupAssignments', 'groupsCollapsed', 'folderOrder',
] as const

type SharedField = typeof SHARED_FIELDS[number]
export type SharedUiState = Pick<UiState, SharedField>

/**
 * The window's own key. The window number comes from the URL (set in main/index.ts) because it is
 * needed at the very first render, before any IPC round trip could answer. Window 1 keeps the
 * original, unsuffixed key, so an existing layout is not lost the day this arrived.
 */
function stateKey(): string {
  try {
    const w = new URLSearchParams(window.location.search).get('w')
    return w === null || w === '1' ? 'apiary.ui' : `apiary.ui.${w}`
  } catch {
    return 'apiary.ui'
  }
}

const KEY = stateKey()
/** Window 1's key, which is where the shared half lived before it had a key of its own. */
const FIRST_WINDOW_KEY = 'apiary.ui'
export const SHARED_KEY = 'apiary.shared'

function read(key: string): Partial<UiState> {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as Partial<UiState>) : {}
  } catch {
    return {}
  }
}

function pickShared(state: Partial<UiState>): Partial<SharedUiState> {
  const out: Partial<SharedUiState> = {}
  for (const field of SHARED_FIELDS) {
    if (state[field] !== undefined) (out as Record<string, unknown>)[field] = state[field]
  }
  return out
}

export const DEFAULT_UI_STATE: UiState = {
  collapsed: [],
  groups: [],
  groupAssignments: {},
  groupsCollapsed: [],
  folderOrder: [],
  pinned: [],
  pinnedCollapsed: false,
  selectedSessionId: null,
  sidebarWidth: 320,
  bottomHeight: 200,
  importDialogWidth: 620,
}

export function loadUiState(): UiState {
  // The shared half falls back to window 1's own record: before the split, that is where the pins
  // and groups were kept, so an existing install finds its arrangement rather than a clean slate.
  const shared = { ...pickShared(read(FIRST_WINDOW_KEY)), ...pickShared(read(SHARED_KEY)) }
  return { ...DEFAULT_UI_STATE, ...read(KEY), ...shared }
}

/** Reads only the shared half — what a `storage` event from another window means. */
export function loadSharedUiState(): SharedUiState {
  return { ...DEFAULT_UI_STATE, ...pickShared(read(SHARED_KEY)) }
}

export function saveUiState(state: UiState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
    localStorage.setItem(SHARED_KEY, JSON.stringify(pickShared(state)))
  } catch {
    // Storage can be unavailable; the app works fine without persistence.
  }
}

/**
 * Calls back when another window changes the shared half.
 *
 * `storage` fires in every same-origin document *except* the one that wrote, which is exactly the
 * semantics wanted here: pinning a session in one window updates the other's sidebar as it
 * happens, with no echo back to the window the pin was made in.
 */
export function subscribeSharedUiState(onChange: (shared: SharedUiState) => void): () => void {
  const listener = (e: StorageEvent): void => {
    if (e.key !== null && e.key !== SHARED_KEY) return
    onChange(loadSharedUiState())
  }
  window.addEventListener('storage', listener)
  return () => { window.removeEventListener('storage', listener) }
}
