import { ignoreErrors } from '@shared/ignoreErrors'
import type { SessionGroup } from '../features/sidebar/model/groups'
import { detachedKey } from './windowParams'

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
  /**
   * Top-level folders whose every worktree is listed, not only the ones with sessions — the folder
   * menu's "Show all worktrees", so a session can be started in a worktree Claude has never run in.
   */
  showAllWorktrees: string[]
  /**
   * Worktrees made with Apiary's "New worktree", and the folder each was made from. Listed under
   * that folder from the moment they exist: no session has run in one yet, so nothing in
   * `~/.claude/projects` names it, and it would otherwise be missing from the tree just after
   * being made.
   */
  createdWorktrees: { folder: string; path: string }[]
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
  'dismissedRecent', 'recentCollapsed', 'showAllWorktrees', 'createdWorktrees',
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

// detachedKey, detachedTransfer and restoredWindow — all URL parsing rather than anything about
// the `UiState` model itself — now live in ./windowParams (UI-18).

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
  showAllWorktrees: [],
  createdWorktrees: [],
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
    // eslint-disable-next-line apiary/no-silent-catch -- storage can be unavailable; the app works fine without persistence
  } catch {
    // Storage can be unavailable; the app works fine without persistence.
  }
}

const COMPOSER_HEIGHT_KEY = 'apiary.composerHeight'

/** The height the user dragged the composer to, or null if never (or storage is unavailable). */
export function loadComposerHeight(minHeight: number): number | null {
  try {
    const n = Number(localStorage.getItem(COMPOSER_HEIGHT_KEY))
    return Number.isFinite(n) && n >= minHeight ? n : null
  } catch {
    return null
  }
}

/** Remembers a dragged composer height, or forgets it for `null` (the box fits its text again). */
export function saveComposerHeight(height: number | null): void {
  try {
    if (height === null) localStorage.removeItem(COMPOSER_HEIGHT_KEY)
    else localStorage.setItem(COMPOSER_HEIGHT_KEY, String(height))
    // eslint-disable-next-line apiary/no-silent-catch -- storage can be blocked; the composer height is only a convenience
  } catch {
    // Storage can be unavailable; the composer just starts at its fitted height next time.
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

/** Per-chat settings: sessionId -> settingId -> value. */
export type PerChatSettings = Record<string, Record<string, boolean>>

/**
 * Its own shared key, not a field of `UiState`: every window saves its whole `UiState` on each
 * change, and a stale copy of this would overwrite a choice made in another window.
 */
export const CHAT_SETTINGS_KEY = 'apiary.chatSettings'

export function loadChatSettings(): PerChatSettings {
  try {
    const raw = localStorage.getItem(CHAT_SETTINGS_KEY)
    const saved: unknown = raw ? JSON.parse(raw) : {}
    return typeof saved === 'object' && saved !== null && !Array.isArray(saved) ? (saved as PerChatSettings) : {}
  } catch {
    return {}
  }
}

export function saveChatSettings(settings: PerChatSettings): void {
  ignoreErrors(() => { localStorage.setItem(CHAT_SETTINGS_KEY, JSON.stringify(settings)) }, 'storage can be unavailable; the app works without persistence')
}

/** Calls back when another window changes a chat's settings. */
export function subscribeChatSettings(onChange: () => void): () => void {
  const listener = (e: StorageEvent): void => {
    if (e.key === null || e.key === CHAT_SETTINGS_KEY) onChange()
  }
  window.addEventListener('storage', listener)
  return () => { window.removeEventListener('storage', listener) }
}
