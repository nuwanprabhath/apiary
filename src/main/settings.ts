import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface AppSettings {
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
  claudeBin: null,
  autoImportAll: false,
  autoImportIntervalMinutes: null,
  revealActiveInSidebar: true,
  searchChatContent: true,
  searchSessionNotes: true,
  updateAutomaticChecks: true,
  updateCheckIntervalHours: 6,
  updateAutoDownload: false,
  updateAllowPrerelease: false,
  updateSkippedVersion: null,
  windowBounds: null,
}

export function loadSettings(file: string): AppSettings {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<AppSettings>
    return { ...DEFAULT_SETTINGS, ...raw }
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
