import { isAbsolute } from 'node:path'
import type { AppSettingsPayload } from '@shared/domain/settings'
import { errorMessage } from '@shared/errors'
import { clamp, isFiniteNumber, isRecord } from '@shared/guards'
import { JsonStore } from './fs/jsonStore'
import { log } from './log/logger'
import type { WindowBounds } from './windows/windowBounds'
import { mergePayload } from '@shared/settings/schema'
import type { ConsentState } from './statusBar/claudeUsage/consent'
import { DEFAULT_SETTINGS_PAYLOAD } from '@shared/settingsDefaults'

/**
 * The shape of the stored file, bumped when an existing one needs adjusting as it is read.
 *
 * Without this, a changed default reaches nobody. `saveSettings` writes the whole object, and the
 * app writes it whenever the window is moved or resized — so every settings.json in existence
 * already pins every field to whatever the default was on the day it was first written, and a new
 * default only ever applies to someone who has never used the app.
 */
export const SETTINGS_VERSION = 1

/**
 * The full stored shape: `AppSettingsPayload` (shared/domain/settings.ts) plus what only main
 * needs. Kept as an extension rather than a hand-repeated copy (MAIN-22 / SHARED-2) — before this,
 * every one of the 20 shared fields, and its doc comment, was spelled out twice.
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
 * Clamps a Recent-window hour count to 1..168, exactly like the settings dialog's own input does
 * — but here, where it is persisted, so a value never has to arrive through the dialog to be
 * trusted.
 *
 * Both the settings store's `parse` and, via the schema's range for `recentSectionHours`
 * (`shared/settings/schema.ts`), the `settingsSet` IPC merge clamp every value rather than relying
 * on the renderer's own clamp. A stale renderer build, devtools, or a hand-edited
 * settings.json can all hand a 0, a negative number, a fraction, or something that is not a
 * number at all straight to the main process, which otherwise persists it verbatim — and once
 * `recentSectionHours` is `<= 0`, `windowMs` in `selectRecent` never admits anything, so Recent
 * goes silently and permanently empty with no error and, since `loadSettings` only fills in
 * *missing* fields, no way to self-correct on the next launch. Accepting `unknown` rather than
 * `number` is deliberate: the whole point is that the value on disk or over IPC is not
 * guaranteed to actually be one.
 */
export function clampRecentHours(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  return isFiniteNumber(n) && n >= 1 ? clamp(Math.round(n), 1, 168) : 1
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

/**
 * The settings file as a `JsonStore`: `schemaVersion` is its version key, `migrateSettings` its
 * migration, and missing or corrupt settings give the defaults — they must never stop the app from
 * starting.
 */
export function createSettingsStore(file: string): JsonStore<AppSettings> {
  return new JsonStore<AppSettings>({
    file,
    version: SETTINGS_VERSION,
    versionKey: 'schemaVersion',
    parse: (raw) => {
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
 * Merges a settings payload arriving over IPC into the current settings. What a field must look
 * like is declared with the field, in `shared/settings/schema.ts`; this runs `mergePayload` over
 * that schema and keeps the main-only fields (`schemaVersion`, `updateSkippedVersion`,
 * `windowBounds`) from `current`.
 *
 * The payload is typed as `AppSettingsPayload`, but it crosses a process boundary from a renderer
 * that is not guaranteed to be the same build as this process — a dev reload, or an update that
 * reloads the window — so it is treated as a `Partial`. **A missing field means "leave it alone",
 * never "off"**: assigning it straight across would write `undefined`, which is falsy — the feature
 * would switch off in this process, its index wiped as a switch-off is meant to do, and
 * `JSON.stringify` would drop the undefined key on the way to disk, so `settings.json` would still
 * say the feature was on. Nothing about that is visible from the outside. This is the bug that made
 * session notes stop being indexed; see CLAUDE.md "Settings arriving over IPC".
 *
 * A field that is present but the wrong type, or a `claudeBin` that is not an absolute path (SEC-8),
 * is dropped the same way and logged by key (never by value). `knownPluginIds` is passed in rather
 * than looked up here, so this stays a pure function of its arguments — the caller already has
 * `AppService.listPlugins()`.
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
