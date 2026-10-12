import { ignoreErrors } from '@shared/ignoreErrors'
import { detachedKey } from './windowParams'

/**
 * What belongs to this window: the tabs' widths, the folders it has open, its selected session.
 *
 * Only the viewer's half is here. How the user has arranged the library (pins, groups, folder
 * order, each chat's settings) describes the sessions, not the screen, so main owns it on the
 * machine those sessions are on and every window reads it through `libraryStateStore` — which is
 * what lets a remote window show the work machine's arrangement. A preference of that kind is an
 * entry in `LIBRARY_STATE` (`shared/libraryState.ts`), never a field here:
 * `tests/unit/architecture/libraryStateHome.test.ts` fails when one is added to this file.
 */
export interface ViewerUiState {
  /**
   * Paths of folders the user has deliberately collapsed. Anything NOT in this list is open,
   * including a folder that has never been seen before — so a newly discovered folder opens by
   * default, and a folder the user closed stays closed across remounts and restarts, without
   * needing any separate "have we seen this path before" bookkeeping.
   */
  collapsed: string[]
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

function read(key: string): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(key)
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

const DEFAULT_UI_STATE: ViewerUiState = {
  collapsed: [],
  selectedSessionId: null,
  sidebarWidth: 320,
  sidebarHidden: false,
  bottomHeight: 200,
  terminalListWidth: null,
  importDialogWidth: 620,
}

/** Only this window's own fields: a record written before 1.39 also holds the library's. */
function pickViewer(stored: Record<string, unknown>): Partial<ViewerUiState> {
  const out: Record<string, unknown> = {}
  for (const field of Object.keys(DEFAULT_UI_STATE)) {
    if (stored[field] !== undefined) out[field] = stored[field]
  }
  return out
}

export function loadUiState(): ViewerUiState {
  // A torn-off window starts with its sidebar folded to the rail: it was torn off to give one
  // session the room, but the rail keeps the rest of the library a click away rather than out of
  // reach — which is what it was until the sidebar was kept in these windows at all.
  //
  // Applied over what is stored, not as a default beneath it: window numbers are reused, and the
  // record under this number may be an earlier window's that had its sidebar open — which is how
  // a tab popped out into "W6" arrived with the sidebar fully out.
  const state = { ...DEFAULT_UI_STATE, ...pickViewer(read(KEY)) }
  return detachedKey() !== null ? { ...state, sidebarHidden: true } : state
}

export function saveUiState(state: ViewerUiState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
    // eslint-disable-next-line apiary/no-silent-catch -- storage can be unavailable; the app works fine without persistence
  } catch {
    // Storage can be unavailable; the app works fine without persistence.
  }
}

/**
 * Where Apiary 1.38 and earlier kept the library state on this machine, read once so a local window
 * can seed main with it (`libraryStateStore`): window 1's record (where it lived before it had a key
 * of its own), the shared key over it, and the per-chat settings. Never written again, and left in
 * place, so a downgrade still finds what it had.
 */
export function legacyLibraryRecords(): { arrangement: Record<string, unknown>; chats: unknown } {
  return { arrangement: { ...read('apiary.ui'), ...read('apiary.shared') }, chats: read('apiary.chatSettings') }
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
const COMPOSER_COLLAPSED_KEY = 'apiary.composerCollapsed'

/** Whether the message box is folded away, for every composer in this viewer's windows. */
export function loadComposerCollapsed(): boolean {
  try {
    return localStorage.getItem(COMPOSER_COLLAPSED_KEY) === 'true'
  } catch {
    return false
  }
}

export function saveComposerCollapsed(collapsed: boolean): void {
  ignoreErrors(() => { localStorage.setItem(COMPOSER_COLLAPSED_KEY, String(collapsed)) }, 'storage can be unavailable; the box just starts open next time')
}

