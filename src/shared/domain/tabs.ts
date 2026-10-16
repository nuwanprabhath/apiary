import type { ActivityStatus } from '../activity'
import type { PtyId } from './ids'

/** What a tab shows: a session's conversation, or a terminal attached to its pty. */
export type TabView = 'transcript' | 'terminal'

/**
 * A session tab on its way from one window to another. The key alone cannot carry a *running*
 * session: one started or forked here runs under a `new:<uuid>` pty id that only the starting
 * window knows belongs to it, as do its bottom shells, so a window handed the bare session id
 * would show it as stopped while the process runs on. The pty id and shells travel here.
 */
export interface TabTransfer {
  key: string
  view: TabView
  /** The pty the session runs under, when that is not the key itself. */
  ptyId: PtyId | null
  /** The bottom shell tabs, in order, and which one was in front. */
  shells: { id: string; name: string }[]
  activeShell: string | null
}

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

/** `TabTransfer` minus `ptyId`: a record read back on the next launch has no live pty. */
export type PersistedTab = Omit<TabTransfer, 'ptyId'>

export interface PersistedPane {
  id: string
  tabs: PersistedTab[]
  activeTab: string | null
  /** Folded down to its tab bar; absent when open. */
  collapsed?: boolean
}

/**
 * `preset` is a plain string, not the renderer's `PresetId`: this file is imported by `main/` too,
 * and `renderer/state/layout.ts` is renderer-only.
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
    && (v.collapsed === undefined || typeof v.collapsed === 'boolean')
}

/**
 * Whether something read out of a URL is a well-formed `WindowLayoutReport`: validates
 * `?restore=` (main strips `bounds`/`hasLayout` first), as `isTabTransfer` validates `?transfer=`.
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
  ptyId: PtyId | null
  /** The tab's own title for a tab with no session yet (a pending new session or fork); null once
   *  it has a session, whose title comes from the tree. */
  label: string | null
}

/** What `reportTabs` sends; main fills `windowNumber` in from the IPC event's sender. */
export type ReportedTab = Omit<OpenTab, 'windowNumber'>

/** An `OpenTab` with its computed status for the sidebar's Active section, minus the pty id (only main needs it). */
export interface ActiveTabPayload {
  windowNumber: number
  key: string
  view: TabView
  status: ActivityStatus
  /** The tab's title while it has no session yet (see `reportTabs`); null otherwise. */
  label: string | null
}
