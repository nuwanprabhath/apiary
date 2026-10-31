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


/**
 * What was typed into a session's message box and not sent, by session. One record for every
 * window (no window suffix), so a tab dragged to another window finds its draft there, and written
 * on each change rather than on unmount, which the receiving window can mount before. The newest
 * `MAX_DRAFTS` are kept.
 */
const DRAFTS_KEY = 'apiary.drafts'
const MAX_DRAFTS = 50

function readDrafts(): Array<[string, string]> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(DRAFTS_KEY) ?? '[]')
    return Array.isArray(parsed)
      ? parsed.filter((e): e is [string, string] => Array.isArray(e) && typeof e[0] === 'string' && typeof e[1] === 'string')
      : []
  } catch {
    return []
  }
}

export function readDraft(sessionId: string): string {
  return readDrafts().find(([id]) => id === sessionId)?.[1] ?? ''
}

/** An empty text forgets the session's draft. */
export function writeDraft(sessionId: string, text: string): void {
  const others = readDrafts().filter(([id]) => id !== sessionId)
  const next = text === '' ? others : [...others, [sessionId, text] as [string, string]].slice(-MAX_DRAFTS)
  ignoreErrors(() => { localStorage.setItem(DRAFTS_KEY, JSON.stringify(next)) }, 'storage can be full or blocked; the draft then lives only as long as the box')
}

/**
 * Each session's side-question thread (`/btw`), so a later `/btw` reopens it, after the card was
 * closed, in another window, or after a restart. Only finished exchanges are kept: the newest
 * `MAX_ASIDE_TURNS` of the newest `MAX_ASIDE_THREADS` sessions.
 */
export interface StoredAsideTurn {
  question: string
  answer: string | null
  error: string | null
}

const ASIDES_KEY = 'apiary.asides'
const MAX_ASIDE_THREADS = 30
const MAX_ASIDE_TURNS = 20

const isStoredTurn = (t: unknown): t is StoredAsideTurn => {
  if (typeof t !== 'object' || t === null) return false
  const r = t as Record<string, unknown>
  return typeof r.question === 'string' && (r.answer === null || typeof r.answer === 'string') && (r.error === null || typeof r.error === 'string')
}

function readAsides(): Array<[string, StoredAsideTurn[]]> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(ASIDES_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((e): Array<[string, StoredAsideTurn[]]> =>
      (Array.isArray(e) && typeof e[0] === 'string' && Array.isArray(e[1]) ? [[e[0], e[1].filter(isStoredTurn)]] : []))
  } catch {
    return []
  }
}

export function readAsideThread(sessionId: string): StoredAsideTurn[] {
  return readAsides().find(([id]) => id === sessionId)?.[1] ?? []
}

/** An empty thread forgets the session's. */
export function writeAsideThread(sessionId: string, turns: readonly StoredAsideTurn[]): void {
  const others = readAsides().filter(([id]) => id !== sessionId)
  const next = turns.length === 0 ? others : [...others, [sessionId, turns.slice(-MAX_ASIDE_TURNS)] as [string, StoredAsideTurn[]]].slice(-MAX_ASIDE_THREADS)
  ignoreErrors(() => { localStorage.setItem(ASIDES_KEY, JSON.stringify(next)) }, 'storage can be full or blocked; the thread then lasts only as long as this window')
}

/** The resident chat popup's rectangle, in px from the window's bottom-right corner (it is anchored there). */
export interface ResidentPopupRect {
  right: number
  bottom: number
  width: number
  height: number
}

const RESIDENT_POPUP_KEY = 'residentPopup'

const isPopupRect = (v: unknown): v is ResidentPopupRect => {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return [r.right, r.bottom, r.width, r.height].every((n) => typeof n === 'number' && Number.isFinite(n))
}

/** This window's popup rectangle; null until it has been moved or resized here. */
export function readResidentPopupRect(): ResidentPopupRect | null {
  const stored = read(`${KEY}.${RESIDENT_POPUP_KEY}`)
  return isPopupRect(stored) ? stored : null
}

export function writeResidentPopupRect(rect: ResidentPopupRect): void {
  ignoreErrors(() => { localStorage.setItem(`${KEY}.${RESIDENT_POPUP_KEY}`, JSON.stringify(rect)) }, 'storage can be full or blocked; the popup then opens where it opens by default')
}

/** One string per resident, in one record every window shares. */
function readPerResident(key: string): Record<string, string> {
  return Object.fromEntries(Object.entries(read(key)).filter((e): e is [string, string] => typeof e[1] === 'string'))
}

function writePerResident(key: string, residentId: string, value: string, why: string): void {
  const others = Object.entries(readPerResident(key)).filter(([id]) => id !== residentId)
  const next = Object.fromEntries(value === '' ? others : [...others, [residentId, value]])
  ignoreErrors(() => { localStorage.setItem(key, JSON.stringify(next)) }, why)
}

const RESIDENT_DRAFTS_KEY = 'apiary.residentDrafts'
const RESIDENT_SEEN_KEY = 'apiary.residentSeen'

/** What was typed to a resident and not sent. */
export function readResidentDraft(residentId: string): string {
  return readPerResident(RESIDENT_DRAFTS_KEY)[residentId] ?? ''
}

/** An empty text forgets the draft. */
export function writeResidentDraft(residentId: string, text: string): void {
  writePerResident(RESIDENT_DRAFTS_KEY, residentId, text, 'storage can be full or blocked; the draft then lives only as long as the box')
}

/** The id of the resident's newest message the person has seen in its popup, or null. */
export function readResidentSeen(residentId: string): string | null {
  return readPerResident(RESIDENT_SEEN_KEY)[residentId] ?? null
}

export function writeResidentSeen(residentId: string, messageId: string): void {
  writePerResident(RESIDENT_SEEN_KEY, residentId, messageId, 'storage can be full or blocked; the unread dot then comes back after a reload')
}

const STATUS_BAR_HEIGHT_KEY = 'apiary.statusBarHeight'

/** The status bar's chosen height in px, shared by every window of this machine; null when never set. */
export function readStatusBarHeight(): number | null {
  try {
    const raw = localStorage.getItem(STATUS_BAR_HEIGHT_KEY)
    const n = Number(raw)
    return raw !== null && Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

export function writeStatusBarHeight(height: number): void {
  ignoreErrors(() => { localStorage.setItem(STATUS_BAR_HEIGHT_KEY, String(height)) }, 'storage can be full or blocked; the bar then starts at its default height next time')
}

/** Calls `listener` when another window of this machine saves a status bar height. */
export function onStatusBarHeightStored(listener: (height: number | null) => void): () => void {
  const onStorage = (e: StorageEvent): void => { if (e.key === STATUS_BAR_HEIGHT_KEY) listener(readStatusBarHeight()) }
  window.addEventListener('storage', onStorage)
  return () => { window.removeEventListener('storage', onStorage) }
}
