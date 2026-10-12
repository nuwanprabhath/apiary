/**
 * Library state: how the user has arranged and chooses to read *this machine's* sessions, declared
 * once.
 *
 * Viewer state (a sidebar width, which folder is open in this window) belongs to the screen it is
 * on. Library state (pins, groups, folder order, each chat's "Show tool calls") describes the
 * sessions themselves, so it lives with them: main owns it, on the machine whose sessions it
 * describes, in `library-state.json`, and every window reads and writes it over IPC. A remote
 * window's calls reach the work machine, so it shows the work machine's arrangement, not home's
 * (docs/architecture/library-state.md).
 *
 * A mirrored preference is one entry in `LIBRARY_STATE`: its guard and its default. The type
 * (`LibraryState`), the defaults, the validation of a patch arriving over IPC (`isLibraryPatch`),
 * the reading of the file (`parseLibraryState`) and the component tests' fake derive from it.
 * Modelled on `SETTINGS` (`shared/settings/schema.ts`).
 */
import { isRecord } from './guards'
import { arr, bool, num, str, type Guard } from './ipc/guards'

/** A top-level heading the user files folders under in the sidebar. */
export interface SessionGroup {
  id: string
  name: string
}

/** A worktree made with "New worktree", and the folder it was made from. */
export interface CreatedWorktree {
  folder: string
  path: string
}

export interface LibraryFieldDef<T> {
  /** True only for a value of the field's type. A patch with a value that fails it is refused. */
  guard: Guard<T>
  default: T
}

const libraryField = <T>(guard: Guard<T>, def: T): LibraryFieldDef<T> => ({ guard, default: def })

const mapOf = <T>(g: Guard<T>): Guard<Record<string, T>> => (v): v is Record<string, T> =>
  isRecord(v) && Object.values(v).every(g)
const isSessionGroup: Guard<SessionGroup> = (v): v is SessionGroup =>
  isRecord(v) && typeof v.id === 'string' && typeof v.name === 'string'
const isCreatedWorktree: Guard<CreatedWorktree> = (v): v is CreatedWorktree =>
  isRecord(v) && typeof v.folder === 'string' && typeof v.path === 'string'

export const LIBRARY_STATE = {
  /** Pinned session ids, newest first. */
  pinned: libraryField(arr(str), [] as string[]),
  pinnedCollapsed: libraryField(bool, false),
  /** sessionId -> dismissedAtMs, for the Recent section. */
  dismissedRecent: libraryField(mapOf(num), {}),
  recentCollapsed: libraryField(bool, false),
  /** The sidebar's folder groups, in display order. */
  groups: libraryField(arr(isSessionGroup), [] as SessionGroup[]),
  /** Project path -> group id. */
  groupAssignments: libraryField(mapOf(str), {}),
  groupsCollapsed: libraryField(arr(str), [] as string[]),
  /** Top-level project paths in the order the user dragged them into. */
  folderOrder: libraryField(arr(str), [] as string[]),
  /** Folders whose every worktree is listed ("Show all worktrees"). */
  showAllWorktrees: libraryField(arr(str), [] as string[]),
  createdWorktrees: libraryField(arr(isCreatedWorktree), [] as CreatedWorktree[]),
  /** Each chat's own settings ("Show tool calls"), by session id. */
  chatSettings: libraryField(mapOf(mapOf(bool)), {}),
  /** Whether a chat that made no choice of its own hides its tool calls. */
  hideToolCallIo: libraryField(bool, false),
}

export type LibraryKey = keyof typeof LIBRARY_STATE
type ValueOf<D> = D extends LibraryFieldDef<infer T> ? T : never
export type LibraryState = { [K in LibraryKey]: ValueOf<(typeof LIBRARY_STATE)[K]> }
export type LibraryPatch = Partial<LibraryState>

/** What `libraryState` answers: the state, and whether a local window has seeded it yet. */
export interface LibrarySnapshot {
  state: LibraryState
  /**
   * False until the first `seedLibraryState` or `setLibraryState`. A local window that finds it
   * false sends what it kept in localStorage before 1.39, once; a seed after that is refused, so a
   * home machine can never overwrite a work machine's arrangement with its own.
   */
  seeded: boolean
}

// The one place the per-key types are erased, so the loops below can run over every entry.
const LIBRARY_ENTRIES = Object.entries(LIBRARY_STATE) as [LibraryKey, LibraryFieldDef<unknown>][]

export function libraryDefaults(): LibraryState {
  return Object.fromEntries(LIBRARY_ENTRIES.map(([k, def]) => [k, structuredClone(def.default)])) as LibraryState
}

/** A patch over IPC: a record whose every key is a declared field and every value passes its guard. */
export const isLibraryPatch: Guard<LibraryPatch> = (v): v is LibraryPatch =>
  isRecord(v) && Object.entries(v).every(([k, value]) => Object.hasOwn(LIBRARY_STATE, k) && LIBRARY_STATE[k as LibraryKey].guard(value))

/**
 * The declared fields of `raw` whose values pass their guards, and nothing else: what a renderer
 * can send of a record it did not write itself (the localStorage of an older Apiary, for the seed).
 */
export function pickLibraryPatch(raw: unknown): LibraryPatch {
  const out: Record<string, unknown> = {}
  if (!isRecord(raw)) return out
  for (const [k, def] of LIBRARY_ENTRIES) {
    if (Object.hasOwn(raw, k) && def.guard(raw[k])) out[k] = raw[k]
  }
  return out
}

/**
 * Whatever is on disk (a hand-edited file can hold anything) as a full `LibraryState`: each field
 * that passes its guard is kept, a missing or bad one is its default, unknown keys are dropped.
 */
export function parseLibraryState(raw: unknown): LibraryState {
  return { ...libraryDefaults(), ...pickLibraryPatch(raw) }
}
