import { isAbsolute } from 'node:path'
import type { AppSettingsPayload } from '@shared/domain/settings'
import { errorMessage } from '@shared/errors'
import { clamp, isFiniteNumber, isRecord } from '@shared/guards'
import { JsonStore } from './fs/jsonStore'
import { log } from './log/logger'
import type { WindowBounds } from './windows/windowBounds'
import { mergePayload } from '@shared/settings/schema'
import { loadResidents } from '@shared/settings/residents'
import type { ConsentState } from './statusBar/claudeUsage/consent'
import { DEFAULT_SETTINGS_PAYLOAD } from '@shared/settingsDefaults'
import type { LibraryPatch } from '@shared/libraryState'

/**
 * The shape of the stored file, bumped when an existing one needs adjusting as it is read.
 *
 * A changed default reaches nobody otherwise: `saveSettings` writes the whole object, so every
 * settings.json pins every field to its default on the day it was first written.
 */
export const SETTINGS_VERSION = 2

/**
 * The full stored shape: `AppSettingsPayload` (shared/domain/settings.ts) plus what only main
 * needs.
 */
export interface AppSettings extends AppSettingsPayload {
  /** Which migrations have already been applied. Absent in files written before this existed. */
  schemaVersion: number
  /** A version the user chose to skip; the next release is offered as normal. */
  updateSkippedVersion: string | null
  windowBounds: WindowBounds | null
  /**
   * The answer to "may Apiary read Claude Code's token to show usage?" (ADR-0019). Main-only, so
   * the settings dialog and a stale renderer's `settingsSet` can neither grant nor wipe it; the
   * only way in is `statusBarConsent`. Absent in files written before the prompt existed, which
   * reads as `unknown`: an install that already ran the plugin is asked too.
   */
  claudeUsageConsent: ConsentState
}

export const DEFAULT_SETTINGS: AppSettings = {
  ...DEFAULT_SETTINGS_PAYLOAD,
  schemaVersion: SETTINGS_VERSION,
  updateSkippedVersion: null,
  windowBounds: null,
  claudeUsageConsent: 'unknown',
}

/**
 * Clamps a Recent-window hour count to 1..168 where it is persisted, not only in the dialog. A
 * stale renderer, devtools or a hand-edited settings.json can hand over 0, a fraction or a
 * non-number; at `<= 0` `selectRecent` admits nothing and Recent stays empty for good, since
 * `loadSettings` only fills in *missing* fields. Takes `unknown` for that reason.
 */
export function clampRecentHours(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  return isFiniteNumber(n) && n >= 1 ? clamp(Math.round(n), 1, 168) : 1
}

/**
 * Brings a stored settings file up to date as it is read.
 *
 * Version 1 turns the prompt trim on at one folder; a migration, because `terminalShortenPath:
 * false` is already written down everywhere. It only touches values still exactly the old defaults.
 */
export function migrateSettings(raw: Partial<AppSettings>): Partial<AppSettings> {
  const from = raw.schemaVersion ?? 0
  if (from >= SETTINGS_VERSION) return raw
  return { ...withoutMoved(from < 1 ? migrateToV1(raw) : raw), schemaVersion: SETTINGS_VERSION }
}

function migrateToV1(raw: Partial<AppSettings>): Partial<AppSettings> {
  const chose = raw.terminalShortenPath === true
    || (raw.terminalPathSegments !== undefined && raw.terminalPathSegments !== 2)
  return chose ? raw : { ...raw, terminalShortenPath: true, terminalPathSegments: 1 }
}

/**
 * Version 2 moved `hideToolCallIo` into the library state (`shared/libraryState.ts`): it says how
 * this machine's chats are shown, so a remote window must read the work machine's. The key is
 * dropped here; `movedSettings` is what the library state is given in its place.
 */
const MOVED_TO_LIBRARY = ['hideToolCallIo'] as const

function withoutMoved(raw: Partial<AppSettings>): Partial<AppSettings> {
  const out: Record<string, unknown> = { ...raw }
  for (const key of MOVED_TO_LIBRARY) delete out[key]
  return out
}

/** The values a pre-2 settings file holds for keys that now live in the library state. */
function movedSettings(raw: unknown): LibraryPatch {
  if (!isRecord(raw) || (isFiniteNumber(raw.schemaVersion) && raw.schemaVersion >= 2)) return {}
  return typeof raw.hideToolCallIo === 'boolean' ? { hideToolCallIo: raw.hideToolCallIo } : {}
}

/**
 * The settings file as a `JsonStore`: `schemaVersion` is its version key, `migrateSettings` its
 * migration, and missing or corrupt settings give the defaults — they must never stop the app from
 * starting.
 */
export function createSettingsStore(file: string, onMoved?: (moved: LibraryPatch) => void): JsonStore<AppSettings> {
  return new JsonStore<AppSettings>({
    file,
    version: SETTINGS_VERSION,
    versionKey: 'schemaVersion',
    parse: (raw) => {
      onMoved?.(movedSettings(raw))
      if (!isRecord(raw)) return DEFAULT_SETTINGS
      const merged = { ...DEFAULT_SETTINGS, ...migrateSettings(raw) }
      // `migrateSettings`/the defaults spread only fill in *missing* fields — a present-but-invalid
      // one (a settings.json hand-edited or left over from a build that didn't validate) passes
      // straight through otherwise, so it is clamped here on every load, not only on write.
      return {
        ...merged,
        recentSectionHours: clampRecentHours(merged.recentSectionHours),
        // A hand-edited or future value is "not asked", never a grant.
        claudeUsageConsent: merged.claudeUsageConsent === 'granted' || merged.claudeUsageConsent === 'declined' ? merged.claudeUsageConsent : 'unknown',
        residents: loadResidents(merged.residents),
      }
    },
    fallback: () => DEFAULT_SETTINGS,
  })
}

/** Writes the settings; a read-only home directory must not crash the app, so a failure is logged. */
export function saveSettings(store: JsonStore<AppSettings>, settings: AppSettings): void {
  try {
    store.save(settings)
  } catch (e) {
    log.warn('settings', 'could not write settings', { error: errorMessage(e) })
  }
}

/**
 * Merges a settings payload arriving over IPC into the current settings: runs `mergePayload` over
 * the schema in `shared/settings/schema.ts` and keeps the main-only fields (`schemaVersion`,
 * `updateSkippedVersion`, `windowBounds`) from `current`.
 *
 * The renderer may be a different build, so the payload is treated as a `Partial`. **A missing
 * field means "leave it alone", never "off"** (see CLAUDE.md "Settings arriving over IPC").
 *
 * A field of the wrong type, or a `claudeBin` that is not an absolute path, is dropped the same
 * way and logged by key (never by value). `knownPluginIds` is passed in to keep this pure.
 */
export function mergeSettingsPayload(
  current: AppSettings,
  next: Partial<AppSettingsPayload>,
  knownPluginIds: ReadonlySet<string>,
): AppSettings {
  const { merged, rejected } = mergePayload(current, next, { knownPluginIds, isAbsolutePath: isAbsolute })
  if (rejected.length > 0) log.warn('settings', 'ignored invalid settings over IPC', { keys: rejected })
  return { ...current, ...merged }
}
