import type { SessionGroup } from './groups'
import { isTabTransfer, isWindowLayoutReport, type TabTransfer, type WindowLayoutReport } from '@shared/types'

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
  /** sessionId -> dismissedAtMs, for the Recent section. Shared like `pinned`: dismissing a
   *  session is an act on the library, not on one window. */
  dismissedRecent: Record<string, number>
  /** Whether the Recent section itself is collapsed. */
  recentCollapsed: boolean
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
  /** Whether this window's sidebar is folded away to a rail, leaving the sessions the width. */
  sidebarHidden: boolean
  bottomHeight: number
  /** Width the terminal list was dragged to, or null to fit its longest terminal name. */
  terminalListWidth: number | null
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
  'dismissedRecent', 'recentCollapsed',
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

/**
 * The tab this window was torn off to show, or null for an ordinary window.
 *
 * Read from the URL for the same reason the window number is: it decides the whole layout, and a
 * window that asked over IPC would paint the full sidebar first and rearrange itself a moment
 * later.
 */
export function detachedKey(): string | null {
  try {
    const key = new URLSearchParams(window.location.search).get('detach')
    return key === null || key === '' ? null : key
  } catch {
    return null
  }
}

/**
 * Everything else about the tab this window was torn off to show — see TabTransfer. Null when the
 * window is an ordinary one, or when the URL carries something that is not a tab.
 */
export function detachedTransfer(): TabTransfer | null {
  try {
    const raw = new URLSearchParams(window.location.search).get('transfer')
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    return isTabTransfer(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * The previous run's record for this window, or null for an ordinary launch. Read from the URL
 * for the same reason `detachedTransfer` is: the layout it decides is needed at first render, and
 * main has already validated and stripped `bounds` (and `hasLayout`, a main-only pruning signal)
 * out of it before putting it here (see `createWindow` in main/index.ts). Detached windows never
 * carry `?restore=`, but a window with both would be a bug worth not acting on, so a detached
 * window is never treated as a restored one even if it somehow did.
 */
export function restoredWindow(): WindowLayoutReport | null {
  try {
    if (detachedKey() !== null) return null
    const raw = new URLSearchParams(window.location.search).get('restore')
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    return isWindowLayoutReport(parsed) ? parsed : null
  } catch {
    return null
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
  dismissedRecent: {},
  recentCollapsed: false,
  selectedSessionId: null,
  sidebarWidth: 320,
  sidebarHidden: false,
  bottomHeight: 200,
  terminalListWidth: null,
  importDialogWidth: 620,
}

export function loadUiState(): UiState {
  // The shared half falls back to window 1's own record: before the split, that is where the pins
  // and groups were kept, so an existing install finds its arrangement rather than a clean slate.
  const shared = { ...pickShared(read(FIRST_WINDOW_KEY)), ...pickShared(read(SHARED_KEY)) }
  // A torn-off window starts with its sidebar folded to the rail: it was torn off to give one
  // session the room, but the rail keeps the rest of the library a click away rather than out of
  // reach — which is what it was until the sidebar was kept in these windows at all.
  //
  // Applied over what is stored, not as a default beneath it: window numbers are reused, and the
  // record under this number may be an earlier window's that had its sidebar open — which is how
  // a tab popped out into "W6" arrived with the sidebar fully out.
  const state = { ...DEFAULT_UI_STATE, ...read(KEY), ...shared }
  return detachedKey() !== null ? { ...state, sidebarHidden: true } : state
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
