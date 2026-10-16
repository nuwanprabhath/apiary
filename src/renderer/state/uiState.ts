import { ignoreErrors } from '@shared/ignoreErrors'
import { detachedKey } from './windowParams'

/**
 * What belongs to this window's screen. How the library is arranged (pins, groups, folder order,
 * each chat's settings) describes the sessions, so it is an entry in `LIBRARY_STATE`
 * (`shared/libraryState.ts`), never a field here:
 * `tests/unit/architecture/libraryStateHome.test.ts` fails when one is added.
 */
export interface ViewerUiState {
  /** Folders the user collapsed; anything not listed is open, so a newly discovered folder opens by default. */
  collapsed: string[]
  selectedSessionId: string | null
  sidebarWidth: number
  /** Folded away to a rail. */
  sidebarHidden: boolean
  bottomHeight: number
  /** Null fits the longest terminal name. */
  terminalListWidth: number | null
  importDialogWidth: number
}

/**
 * The window's own storage key. The window number comes from the URL because it is needed at the
 * first render, before any IPC could answer. Window 1 keeps the unsuffixed key.
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

/** Only this window's own fields: an older record also holds the library's. */
function pickViewer(stored: Record<string, unknown>): Partial<ViewerUiState> {
  const out: Record<string, unknown> = {}
  for (const field of Object.keys(DEFAULT_UI_STATE)) {
    if (stored[field] !== undefined) out[field] = stored[field]
  }
  return out
}

export function loadUiState(): ViewerUiState {
  // A torn-off window starts with its sidebar folded, applied over what is stored: window numbers
  // are reused, and the record under this number may be an earlier window's.
  const state = { ...DEFAULT_UI_STATE, ...pickViewer(read(KEY)) }
  return detachedKey() !== null ? { ...state, sidebarHidden: true } : state
}

export function saveUiState(state: ViewerUiState): void {
  try {
    // `foldedPanes` is saved on its own (`saveFoldedPanes`); this whole-state write must keep it.
    const foldedPanes = read(KEY).foldedPanes
    localStorage.setItem(KEY, JSON.stringify(foldedPanes === undefined ? state : { ...state, foldedPanes }))
    // eslint-disable-next-line apiary/no-silent-catch -- storage can be unavailable; the app works fine without persistence
  } catch {
    // Storage can be unavailable; the app works fine without persistence.
  }
}

/**
 * Where the library state used to live, read once so a local window can seed main with it
 * (`libraryStateStore`). Never written, and left in place so a downgrade still finds it.
 */
export function legacyLibraryRecords(): { arrangement: Record<string, unknown>; chats: unknown } {
  return { arrangement: { ...read('apiary.ui'), ...read('apiary.shared') }, chats: read('apiary.chatSettings') }
}

const COMPOSER_HEIGHT_KEY = 'apiary.composerHeight'

export function loadComposerHeight(minHeight: number): number | null {
  try {
    const n = Number(localStorage.getItem(COMPOSER_HEIGHT_KEY))
    return Number.isFinite(n) && n >= minHeight ? n : null
  } catch {
    return null
  }
}

/** `null` forgets the dragged height (the box fits its text again). */
export function saveComposerHeight(height: number | null): void {
  try {
    if (height === null) localStorage.removeItem(COMPOSER_HEIGHT_KEY)
    else localStorage.setItem(COMPOSER_HEIGHT_KEY, String(height))
    // eslint-disable-next-line apiary/no-silent-catch -- storage can be blocked; the composer height is only a convenience
  } catch {
    // Storage can be unavailable; the composer just starts at its fitted height next time.
  }
}

/** The panes whose message box is folded, saved with this window's own record (`columnId` → true). */
export function loadFoldedPanes(): Record<string, true> {
  const stored = read(KEY).foldedPanes
  const out: Record<string, true> = {}
  if (typeof stored === 'object' && stored !== null && !Array.isArray(stored)) {
    for (const [id, folded] of Object.entries(stored)) if (folded === true) out[id] = true
  }
  return out
}

export function saveFoldedPanes(panes: Record<string, true>): void {
  ignoreErrors(() => { localStorage.setItem(KEY, JSON.stringify({ ...read(KEY), foldedPanes: panes })) }, 'storage can be unavailable; the boxes just start open next time')
}

