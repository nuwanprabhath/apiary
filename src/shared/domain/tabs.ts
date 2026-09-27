import type { ActivityStatus } from '../activity'

/** What a tab shows: a session's conversation, or a terminal attached to its pty. Repeated as a
 *  literal union in several places before this (SHARED-3); this is the one definition. */
export type TabView = 'transcript' | 'terminal'

/**
 * A session tab on its way from one window to another.
 *
 * The key alone is not enough to carry a *running* session across. A session started or forked
 * here runs under a `new:<uuid>` pty id that only the window which started it knows belongs to
 * the session, and its bottom shells hang off that same id — so a window handed the bare session
 * id finds no process behind it and shows the session as stopped, while the process runs on with
 * nothing showing it. Everything the receiving window needs to pick the same processes back up
 * travels here instead.
 */
export interface TabTransfer {
  key: string
  view: TabView
  /** The pty the session runs under, when that is not the key itself. */
  ptyId: string | null
  /** The bottom shell tabs, in order, and which one was in front. */
  shells: { id: string; name: string }[]
  activeShell: string | null
}

/** A tab strip's shell tabs, the shape shared by `TabTransfer` and `PersistedTab`. */
function isShellList(value: unknown): value is { id: string; name: string }[] {
  return Array.isArray(value) && value.every((s: unknown) => typeof s === 'object' && s !== null
    && typeof (s as Record<string, unknown>).id === 'string'
    && typeof (s as Record<string, unknown>).name === 'string')
}

/** Whether something that came over IPC or out of a URL is a well-formed `TabTransfer`. */
export function isTabTransfer(value: unknown): value is TabTransfer {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.key === 'string' && v.key !== ''
    && (v.view === 'transcript' || v.view === 'terminal')
    && (v.ptyId === null || typeof v.ptyId === 'string')
    && isShellList(v.shells)
    && (v.activeShell === null || typeof v.activeShell === 'string')
}

/** One tab of a persisted window layout — same shape as `TabTransfer` minus `ptyId`, since a
 *  record written to disk and read back on the next launch has no live pty to point at. */
export type PersistedTab = Omit<TabTransfer, 'ptyId'>

export interface PersistedPane {
  id: string
  tabs: PersistedTab[]
  activeTab: string | null
}

/**
 * `preset` is kept as a plain string, not the renderer's `PresetId`: this file is imported by
 * both `main/` (no DOM lib) and the renderer, and `renderer/state/layout.ts` is renderer-only
 * state, not a shared pure helper — pulling it in here would drag renderer code into the main
 * tsconfig project the way `shared/promptPreview.ts`'s own comment warns against.
 */
export interface PersistedLayout {
  preset: string
  panes: PersistedPane[]
}

/** What a window reports to main on every layout change; main adds `bounds` itself. */
export interface WindowLayoutReport {
  number: number
  layout: PersistedLayout
  live: string[]
}

function isPersistedTab(value: unknown): value is PersistedTab {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.key === 'string'
    && (v.view === 'transcript' || v.view === 'terminal')
    && isShellList(v.shells)
    && (v.activeShell === null || typeof v.activeShell === 'string')
}

function isPersistedPane(value: unknown): value is PersistedPane {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.id === 'string'
    && Array.isArray(v.tabs) && v.tabs.every(isPersistedTab)
    && (v.activeTab === null || typeof v.activeTab === 'string')
}

/**
 * Whether something read out of a URL is a well-formed `WindowLayoutReport` — used by the
 * renderer to validate `?restore=`, the previous run's record for this window (main strips
 * `bounds`/`hasLayout` before sending it, since neither is a renderer concern — see
 * `createWindow` in `main/index.ts`), the same way `isTabTransfer` validates `?transfer=`.
 */
export function isWindowLayoutReport(value: unknown): value is WindowLayoutReport {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (typeof v.number !== 'number') return false
  if (!Array.isArray(v.live) || !v.live.every((s) => typeof s === 'string')) return false
  if (typeof v.layout !== 'object' || v.layout === null) return false
  const layout = v.layout as Record<string, unknown>
  return typeof layout.preset === 'string'
    && Array.isArray(layout.panes) && layout.panes.every(isPersistedPane)
}

/** A tab a window currently has open, as it reports itself — see App.tsx's report effect and
 *  `main/windows/tabRegistry.ts`, which holds these across every window. */
export interface OpenTab {
  windowNumber: number
  key: string
  view: TabView
  /** The pty this tab's process runs under, when it has one (a fresh new-session pty before its
   *  real session id exists, or the session id itself once resolved). Null for a transcript-only
   *  tab that has never been run as a terminal. */
  ptyId: string | null
  /** The tab's own title for a tab with no session yet (a pending new session or fork); null once
   *  it has a session, whose title comes from the tree. */
  label: string | null
}

/** What `reportTabs` sends: an `OpenTab` before main knows which window it came from — that is
 *  filled in from the IPC event's sender, not supplied by the renderer. */
export type ReportedTab = Omit<OpenTab, 'windowNumber'>

/** A tab open somewhere, with the activity `classifyActivity` derived for it, for the sidebar's
 *  Active section. Same identity as `OpenTab` plus its computed status, minus the pty id (the
 *  renderer never needs it — only main resolves activity from it). */
export interface ActiveTabPayload {
  windowNumber: number
  key: string
  view: TabView
  status: ActivityStatus
  /** The tab's title while it has no session yet (see `reportTabs`); null otherwise. */
  label: string | null
}
