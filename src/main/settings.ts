import { readFileSync, mkdirSync } from 'node:fs'
import { dirname, isAbsolute } from 'node:path'
import type { AppSettingsPayload } from '@shared/domain/settings'
import { writeJsonAtomic } from './fs/atomicWrite'
import { clampSegments } from '@shared/promptPreview'
import { DEFAULT_SETTINGS_PAYLOAD } from '@shared/settingsDefaults'

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
}

export const DEFAULT_SETTINGS: AppSettings = {
  ...DEFAULT_SETTINGS_PAYLOAD,
  schemaVersion: SETTINGS_VERSION,
  updateSkippedVersion: null,
  windowBounds: null,
}

/**
 * Clamps a Recent-window hour count to 1..168, exactly like the settings dialog's own input does
 * — but here, where it is persisted, so a value never has to arrive through the dialog to be
 * trusted.
 *
 * Both `loadSettings` and the `settingsSet` IPC handler run every value through this rather than
 * relying on the renderer's own clamp. A stale renderer build, devtools, or a hand-edited
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
  return Number.isFinite(n) && n >= 1 ? Math.min(168, Math.round(n)) : 1
}

/**
 * Clamps an integer setting to `[min, max]`, falling back to `min` for anything that is not a
 * finite number once coerced (SEC-8) — the same reasoning as `clampRecentHours`, generalised: a
 * stale renderer build, devtools, or a hand-edited settings.json can hand any of several numeric
 * settings (`updateCheckIntervalHours`, `logRetentionDays`, `logMaxSizeMb`,
 * `autoImportIntervalMinutes`) a value nobody who used the dialog could have produced.
 */
export function clampIntSetting(value: unknown, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : min
}

/** As `clampIntSetting`, but `null` (a real value for some of these fields) passes through. */
export function clampIntOrNullSetting(value: unknown, min: number, max: number): number | null {
  return value === null ? null : clampIntSetting(value, min, max)
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
    const merged = { ...DEFAULT_SETTINGS, ...migrateSettings(raw) }
    // `migrateSettings`/the defaults spread only fill in *missing* fields — a present-but-invalid
    // one (a settings.json hand-edited or left over from a build that didn't validate) passes
    // straight through otherwise, so it is clamped here on every load, not only on write.
    return { ...merged, recentSectionHours: clampRecentHours(merged.recentSectionHours) }
  } catch {
    // Missing or corrupt settings must never stop the app from starting.
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(file: string, settings: AppSettings): void {
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeJsonAtomic(file, settings)
  } catch {
    // A read-only home directory should not crash the app.
  }
}

/**
 * Merges a settings payload arriving over IPC into the current settings.
 *
 * The payload is typed as `AppSettingsPayload`, but it crosses a process boundary from a renderer
 * that is not guaranteed to be the same build as this process — a dev reload, or an update that
 * reloads the window — so it is treated here as a `Partial`: a key the sender has never heard of
 * is simply absent. **A missing field means "leave it alone", never "off"**: assigning it straight
 * across would write `undefined`, which is falsy — the feature would switch off in this process,
 * its index wiped as a switch-off is meant to do, and `JSON.stringify` would drop the undefined
 * key on the way to disk, so `settings.json` would still say the feature was on. Nothing about
 * that is visible from the outside. This is the bug that made session notes stop being indexed;
 * see CLAUDE.md "Settings arriving over IPC".
 *
 * `claudeBin` is the one exception: `null` is a real value there ("find it on PATH"), so it keeps
 * the current value only when the field is missing altogether, not when it is `null`. A non-null
 * value must be an absolute, bounded-length path (SEC-8) — it becomes the binary `resumeCommand`
 * and the theme generator invoke, and is persisted and re-read on every launch — so a value that
 * fails that check is dropped rather than merged, the same as a missing field.
 *
 * Several numeric fields are clamped rather than trusted as `keep` would leave them
 * (`clampRecentHours`, `clampIntSetting`, `clampIntOrNullSetting`, `clampSegments`), since each is
 * typed as a plain number or int but arrives from a renderer that is not guaranteed to have
 * validated it. `pluginSettings` is filtered to plugin ids this build actually knows about and to
 * string/number/boolean values only (SEC-8): the settings dialog only ever sends back what it was
 * given, but the IPC boundary cannot assume the sender validated anything, and an unbounded object
 * here would be persisted to disk and re-read by whatever the plugin's own settings code expects.
 * `knownPluginIds` is passed in rather than looked up here, so this stays a pure function of its
 * arguments — the caller already has `AppService.listPlugins()`.
 */
export function mergeSettingsPayload(
  current: AppSettings,
  next: Partial<AppSettingsPayload>,
  knownPluginIds: ReadonlySet<string>,
): AppSettings {
  const keep = <T>(value: T | undefined, fallback: T): T => value ?? fallback
  const cleanPluginSettings = (
    raw: Record<string, Record<string, string | number | boolean>>,
  ): Record<string, Record<string, string | number | boolean>> => Object.fromEntries(
    Object.entries(raw)
      .filter(([id]) => knownPluginIds.has(id))
      .map(([id, values]) => [
        id,
        Object.fromEntries(
          Object.entries(values).filter(([, v]) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'),
        ),
      ]),
  )
  return {
    ...current,
    claudeBin: next.claudeBin === undefined
      ? current.claudeBin
      : (next.claudeBin === null || (isAbsolute(next.claudeBin) && next.claudeBin.length <= 4096)
        ? next.claudeBin
        : current.claudeBin),
    autoImportAll: keep(next.autoImportAll, current.autoImportAll),
    autoImportIntervalMinutes: next.autoImportIntervalMinutes === undefined
      ? current.autoImportIntervalMinutes
      : clampIntOrNullSetting(next.autoImportIntervalMinutes, 1, 1440),
    revealActiveInSidebar: keep(next.revealActiveInSidebar, current.revealActiveInSidebar),
    searchChatContent: keep(next.searchChatContent, current.searchChatContent),
    searchSessionNotes: keep(next.searchSessionNotes, current.searchSessionNotes),
    recentSectionEnabled: keep(next.recentSectionEnabled, current.recentSectionEnabled),
    recentSectionHours: next.recentSectionHours === undefined
      ? current.recentSectionHours
      : clampRecentHours(next.recentSectionHours),
    terminalShortenPath: keep(next.terminalShortenPath, current.terminalShortenPath),
    terminalPathSegments: next.terminalPathSegments === undefined
      ? current.terminalPathSegments
      : clampSegments(next.terminalPathSegments),
    terminalMinimalPrompt: keep(next.terminalMinimalPrompt, current.terminalMinimalPrompt),
    plugins: keep(next.plugins, current.plugins),
    pluginSettings: next.pluginSettings === undefined ? current.pluginSettings : cleanPluginSettings(next.pluginSettings),
    updateAutomaticChecks: keep(next.updateAutomaticChecks, current.updateAutomaticChecks),
    updateCheckIntervalHours: next.updateCheckIntervalHours === undefined
      ? current.updateCheckIntervalHours
      : clampIntSetting(next.updateCheckIntervalHours, 1, 168),
    updateAutoDownload: keep(next.updateAutoDownload, current.updateAutoDownload),
    updateAllowPrerelease: keep(next.updateAllowPrerelease, current.updateAllowPrerelease),
    diagnosticsEnabled: keep(next.diagnosticsEnabled, current.diagnosticsEnabled),
    logRetentionDays: next.logRetentionDays === undefined
      ? current.logRetentionDays
      : clampIntSetting(next.logRetentionDays, 1, 90),
    logMaxSizeMb: next.logMaxSizeMb === undefined
      ? current.logMaxSizeMb
      : clampIntSetting(next.logMaxSizeMb, 1, 500),
  }
}
