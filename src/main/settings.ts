import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

/**
 * The shape of the stored file, bumped when an existing one needs adjusting as it is read.
 *
 * Without this, a changed default reaches nobody. `saveSettings` writes the whole object, and the
 * app writes it whenever the window is moved or resized — so every settings.json in existence
 * already pins every field to whatever the default was on the day it was first written, and a new
 * default only ever applies to someone who has never used the app.
 */
export const SETTINGS_VERSION = 1

export interface AppSettings {
  /** Which migrations have already been applied. Absent in files written before this existed. */
  schemaVersion: number
  /** Explicit path to the claude binary, used when it is not on PATH. */
  claudeBin: string | null
  /** Import every discovered session automatically, instead of picking them by hand. */
  autoImportAll: boolean
  /** Minutes between automatic rescans, or null when periodic scanning is off. */
  autoImportIntervalMinutes: number | null
  /**
   * Whether activating a tab scrolls the sidebar to that session and highlights it. On by default:
   * with months of history in the tree, finding the row for the session you are looking at is
   * otherwise a hunt. Off for anyone who would rather the sidebar stayed where they left it.
   */
  revealActiveInSidebar: boolean
  /**
   * Whether the search box also matches the *contents* of conversations, not just their titles.
   * On by default; turning it off falls back to title-only search and stops the indexer running.
   */
  searchChatContent: boolean
  /**
   * Whether the notes people write on sessions are searchable. Separate from `searchChatContent`
   * because it is a different bargain: a note is a line the user typed on purpose, so indexing it
   * costs nothing and is what makes it findable later.
   */
  searchSessionNotes: boolean
  /**
   * Trim the working directory in the prompt of shells Apiary starts, to the last
   * `terminalPathSegments` folders. See pty/promptPath.ts — bash 4+ only, by design.
   *
   * One folder, not two. The paths this exists for look like
   * `~/projects/thing.worktrees/pipeline-issues`, and keeping two of those keeps
   * `thing.worktrees/pipeline-issues` — almost the whole thing. The last component is the one that
   * says which worktree you are in; everything before it is what was in the way.
   */
  terminalShortenPath: boolean
  terminalPathSegments: number
  /**
   * Which session-bar plugins are on, by plugin id. A map rather than a field per plugin so
   * adding one does not mean touching the settings shape — which is the point of plugins.
   */
  plugins: Record<string, boolean>
  /**
   * Each plugin's own settings, namespaced by plugin id. Plugins declare what they take (see
   * plugins/types.ts) and Settings draws it, so nothing here needs a field per plugin.
   */
  pluginSettings: Record<string, Record<string, string | number | boolean>>
  /**
   * Update preferences. Checking is on by default — an app that can update itself and doesn't
   * mention it is how people end up months behind — but nothing is ever downloaded or installed
   * without the user saying so, which is what `updateAutoDownload: false` means.
   */
  updateAutomaticChecks: boolean
  /** Hours between automatic checks. Clamped to 1..168 by the service. */
  updateCheckIntervalHours: number
  /** Fetch the update as soon as it is found, instead of after the user agrees. */
  updateAutoDownload: boolean
  /** Offer pre-release builds. */
  updateAllowPrerelease: boolean
  /** A version the user chose to skip; the next release is offered as normal. */
  updateSkippedVersion: string | null
  windowBounds: WindowBounds | null
}

export const DEFAULT_SETTINGS: AppSettings = {
  schemaVersion: SETTINGS_VERSION,
  claudeBin: null,
  autoImportAll: false,
  autoImportIntervalMinutes: null,
  revealActiveInSidebar: true,
  searchChatContent: true,
  searchSessionNotes: true,
  terminalShortenPath: true,
  terminalPathSegments: 1,
  plugins: {},
  pluginSettings: {},
  updateAutomaticChecks: true,
  updateCheckIntervalHours: 6,
  updateAutoDownload: false,
  updateAllowPrerelease: false,
  updateSkippedVersion: null,
  windowBounds: null,
}

/**
 * Brings a stored settings file up to date as it is read.
 *
 * Version 1 turns the prompt trim on at one folder. It is a *migration* rather than a changed
 * default because a changed default could never arrive: the app rewrites the whole settings file
 * every time its window is moved, so `terminalShortenPath: false` is already written down
 * everywhere, chosen by nobody.
 *
 * It only touches values that are still exactly what the old defaults were. Someone who turned
 * the trim on, or who set a segment count of their own, has said what they want and keeps it —
 * so this can only affect people who never made a choice at all, and Settings undoes it in a
 * click either way.
 */
export function migrateSettings(raw: Partial<AppSettings>): Partial<AppSettings> {
  if ((raw.schemaVersion ?? 0) >= SETTINGS_VERSION) return raw

  const chose = raw.terminalShortenPath === true
    || (raw.terminalPathSegments !== undefined && raw.terminalPathSegments !== 2)

  return {
    ...raw,
    schemaVersion: SETTINGS_VERSION,
    ...(chose ? {} : { terminalShortenPath: true, terminalPathSegments: 1 }),
  }
}

export function loadSettings(file: string): AppSettings {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<AppSettings>
    return { ...DEFAULT_SETTINGS, ...migrateSettings(raw) }
  } catch {
    // Missing or corrupt settings must never stop the app from starting.
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(file: string, settings: AppSettings): void {
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(settings, null, 2))
  } catch {
    // A read-only home directory should not crash the app.
  }
}
