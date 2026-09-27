import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readdirSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  loadSettings, saveSettings, DEFAULT_SETTINGS, migrateSettings, SETTINGS_VERSION,
  clampRecentHours, clampIntSetting, clampIntOrNullSetting, mergeSettingsPayload,
} from '../../src/main/settings'

let dir: string
const file = () => join(dir, 'settings.json')

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apiary-settings-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('settings', () => {
  it('returns defaults when the file does not exist', () => {
    expect(loadSettings(file())).toEqual(DEFAULT_SETTINGS)
  })

  it('round-trips values', () => {
    const bounds = { x: 10, y: 20, width: 1200, height: 800 }
    saveSettings(file(), {
      schemaVersion: SETTINGS_VERSION,
      claudeBin: '/opt/claude',
      autoImportAll: true,
      autoImportIntervalMinutes: 30,
      revealActiveInSidebar: false,
      searchChatContent: false,
      searchSessionNotes: false,
      recentSectionEnabled: false,
      recentSectionHours: 12,
      terminalShortenPath: true,
      terminalPathSegments: 3,
      terminalMinimalPrompt: false,
      plugins: { 'gitlab-mr': false },
      pluginSettings: { 'gitlab-mr': { targetBranch: 'dev/1.0.12' } },
      updateAutomaticChecks: false,
      updateCheckIntervalHours: 24,
      updateAutoDownload: true,
      updateAllowPrerelease: true,
      updateSkippedVersion: '1.9.0',
      diagnosticsEnabled: true,
      logRetentionDays: 14,
      logMaxSizeMb: 50,
      windowBounds: bounds,
    })
    expect(loadSettings(file())).toEqual({
      schemaVersion: SETTINGS_VERSION,
      claudeBin: '/opt/claude',
      autoImportAll: true,
      autoImportIntervalMinutes: 30,
      revealActiveInSidebar: false,
      searchChatContent: false,
      searchSessionNotes: false,
      recentSectionEnabled: false,
      recentSectionHours: 12,
      terminalShortenPath: true,
      terminalPathSegments: 3,
      terminalMinimalPrompt: false,
      plugins: { 'gitlab-mr': false },
      pluginSettings: { 'gitlab-mr': { targetBranch: 'dev/1.0.12' } },
      updateAutomaticChecks: false,
      updateCheckIntervalHours: 24,
      updateAutoDownload: true,
      updateAllowPrerelease: true,
      updateSkippedVersion: '1.9.0',
      diagnosticsEnabled: true,
      logRetentionDays: 14,
      logMaxSizeMb: 50,
      windowBounds: bounds,
    })
  })

  it('falls back to defaults on corrupt JSON', () => {
    writeFileSync(file(), '{ not json')
    expect(loadSettings(file())).toEqual(DEFAULT_SETTINGS)
  })

  it('fills in missing keys from defaults', () => {
    writeFileSync(file(), JSON.stringify({ claudeBin: '/opt/claude' }))
    // Stated against the defaults themselves rather than a copy of them: a list of every field
    // has to be edited every time a setting is added, which makes an unrelated change look like
    // a failure and teaches whoever sees it to update the expectation without reading it.
    expect(loadSettings(file())).toEqual({ ...DEFAULT_SETTINGS, claudeBin: '/opt/claude' })
  })

  it('includes new session-related fields in defaults', () => {
    expect(DEFAULT_SETTINGS.autoImportAll).toBe(false)
    expect(DEFAULT_SETTINGS.autoImportIntervalMinutes).toBe(null)
  })

  it('loads old settings files lacking new fields by filling in defaults', () => {
    // Simulate a v1 settings file that has no autoImportAll or autoImportIntervalMinutes.
    writeFileSync(file(), JSON.stringify({ claudeBin: '/opt/claude', windowBounds: null }))
    const loaded = loadSettings(file())
    expect(loaded.autoImportAll).toBe(false)
    expect(loaded.autoImportIntervalMinutes).toBe(null)
    expect(loaded.claudeBin).toBe('/opt/claude')
  })

  it('heals an already-bad recentSectionHours on load, since a missing-field fill-in would leave it alone', () => {
    // A hand-edited file, or one written by a build that didn't validate, persists whatever it
    // was given — filling in *missing* keys from defaults does nothing for a key that is present
    // but out of range, so loadSettings has to clamp it itself on every read.
    writeFileSync(file(), JSON.stringify({ recentSectionHours: 0 }))
    expect(loadSettings(file()).recentSectionHours).toBe(1)
  })
})

describe('saveSettings writes atomically (MAIN-16)', () => {
  it('leaves no temp file behind after a normal save', () => {
    saveSettings(file(), DEFAULT_SETTINGS)
    expect(readdirSync(dir)).toEqual(['settings.json'])
  })

  it('a crash between write and rename keeps the old file, rather than a truncated one', () => {
    saveSettings(file(), { ...DEFAULT_SETTINGS, claudeBin: '/opt/claude' })
    // Simulate the write half of tmp+rename failing (e.g. a full disk) by making the directory
    // unwritable, so the temp file itself cannot be created.
    chmodSync(dir, 0o500)
    try {
      saveSettings(file(), { ...DEFAULT_SETTINGS, claudeBin: '/opt/other' })
    } finally {
      chmodSync(dir, 0o700)
    }
    // The previous, valid settings are still there — never a half-written file that would read
    // back as corrupt (and then get silently replaced by defaults, per loadSettings's fallback).
    expect(loadSettings(file()).claudeBin).toBe('/opt/claude')
    expect(readdirSync(dir)).toEqual(['settings.json'])
  })
})

describe('clampRecentHours', () => {
  it('floors zero up to the 1-hour minimum', () => {
    expect(clampRecentHours(0)).toBe(1)
  })

  it('floors a negative value up to the 1-hour minimum', () => {
    expect(clampRecentHours(-5)).toBe(1)
  })

  it('caps a value above the 168-hour maximum', () => {
    expect(clampRecentHours(200)).toBe(168)
  })

  it('rounds a fraction to the nearest whole hour', () => {
    expect(clampRecentHours(2.7)).toBe(3)
  })

  it('falls back to 1 for a non-numeric value', () => {
    expect(clampRecentHours('not a number')).toBe(1)
    expect(clampRecentHours(undefined)).toBe(1)
    expect(clampRecentHours(NaN)).toBe(1)
  })

  it('leaves an already-valid value unchanged', () => {
    expect(clampRecentHours(24)).toBe(24)
    expect(clampRecentHours(1)).toBe(1)
    expect(clampRecentHours(168)).toBe(168)
  })
})

describe('clampIntSetting', () => {
  // SEC-8: settingsSet trusted several numeric fields verbatim from the renderer
  // (updateCheckIntervalHours, logRetentionDays, logMaxSizeMb, autoImportIntervalMinutes) —
  // a stale build, devtools, or a hand-edited settings.json could set any of them to a NaN, a
  // negative number, or something absurdly large.
  it('clamps below the minimum up to it', () => {
    expect(clampIntSetting(0, 1, 90)).toBe(1)
    expect(clampIntSetting(-5, 1, 90)).toBe(1)
  })

  it('clamps above the maximum down to it', () => {
    expect(clampIntSetting(1000, 1, 90)).toBe(90)
  })

  it('rounds a fraction', () => {
    expect(clampIntSetting(2.7, 1, 90)).toBe(3)
  })

  it('falls back to the minimum for anything that is not a finite number', () => {
    expect(clampIntSetting(NaN, 1, 90)).toBe(1)
    expect(clampIntSetting('nonsense', 1, 90)).toBe(1)
    expect(clampIntSetting(undefined, 1, 90)).toBe(1)
  })

  it('leaves an in-range value unchanged', () => {
    expect(clampIntSetting(7, 1, 90)).toBe(7)
  })
})

describe('clampIntOrNullSetting', () => {
  it('passes null through unchanged — a real value for autoImportIntervalMinutes', () => {
    expect(clampIntOrNullSetting(null, 1, 1440)).toBeNull()
  })

  it('clamps a non-null value the same way clampIntSetting does', () => {
    expect(clampIntOrNullSetting(NaN, 1, 1440)).toBe(1)
    expect(clampIntOrNullSetting(999999, 1, 1440)).toBe(1440)
    expect(clampIntOrNullSetting(30, 1, 1440)).toBe(30)
  })
})

describe('migrating a settings file written by an older version', () => {
  it('turns the prompt trim on, because a changed default could never have reached anyone', () => {
    // The app rewrites the whole settings file whenever its window is moved, so every existing
    // file already pins terminalShortenPath to the default of the day it was first written.
    const migrated = migrateSettings({ terminalShortenPath: false, terminalPathSegments: 2 })
    expect(migrated.terminalShortenPath).toBe(true)
    expect(migrated.terminalPathSegments).toBe(1)
  })

  it('leaves a trim the user switched on alone, including how many folders they chose', () => {
    const migrated = migrateSettings({ terminalShortenPath: true, terminalPathSegments: 3 })
    expect(migrated.terminalShortenPath).toBe(true)
    expect(migrated.terminalPathSegments).toBe(3)
  })

  it('leaves a segment count the user chose alone even with the trim off', () => {
    // Off with three folders set is a choice about both; only untouched values are changed.
    const migrated = migrateSettings({ terminalShortenPath: false, terminalPathSegments: 4 })
    expect(migrated.terminalShortenPath).toBe(false)
    expect(migrated.terminalPathSegments).toBe(4)
  })

  it('runs once: an already-migrated file is returned untouched', () => {
    const chosen = { schemaVersion: SETTINGS_VERSION, terminalShortenPath: false, terminalPathSegments: 2 }
    expect(migrateSettings(chosen)).toEqual(chosen)
  })

  it('stamps the version, so switching it back off afterwards sticks', () => {
    expect(migrateSettings({}).schemaVersion).toBe(SETTINGS_VERSION)
  })
})

describe('mergeSettingsPayload', () => {
  // The bug this guards against (CLAUDE.md "Settings arriving over IPC"): a renderer sending a
  // payload from a stale build omits a key the sender has never heard of, and assigning that
  // straight across writes `undefined` — which reads as falsy and, once serialised, as if the
  // field were never set at all. `next` is exercised as `Partial<AppSettingsPayload>`, matching
  // what actually arrives over IPC rather than the payload type's own (optimistic) full shape.
  const noPlugins = new Set<string>()

  it('leaves every field unchanged when the payload carries nothing at all', () => {
    expect(mergeSettingsPayload(DEFAULT_SETTINGS, {}, noPlugins)).toEqual(DEFAULT_SETTINGS)
  })

  it('a missing field leaves the current value alone, even a boolean current value of true', () => {
    const current = { ...DEFAULT_SETTINGS, searchChatContent: true }
    expect(mergeSettingsPayload(current, {}, noPlugins).searchChatContent).toBe(true)
  })

  it('an explicit false sticks, rather than being treated as missing', () => {
    const current = { ...DEFAULT_SETTINGS, searchChatContent: true }
    expect(mergeSettingsPayload(current, { searchChatContent: false }, noPlugins).searchChatContent).toBe(false)
  })

  it('claudeBin: null sticks — it is a real value ("find it on PATH"), not a missing field', () => {
    const current = { ...DEFAULT_SETTINGS, claudeBin: '/opt/claude' }
    expect(mergeSettingsPayload(current, { claudeBin: null }, noPlugins).claudeBin).toBe(null)
  })

  it('claudeBin stays put when the payload omits it altogether', () => {
    const current = { ...DEFAULT_SETTINGS, claudeBin: '/opt/claude' }
    expect(mergeSettingsPayload(current, {}, noPlugins).claudeBin).toBe('/opt/claude')
  })

  it('a non-absolute claudeBin is dropped (SEC-8), same as a missing field', () => {
    const current = { ...DEFAULT_SETTINGS, claudeBin: '/opt/claude' }
    expect(mergeSettingsPayload(current, { claudeBin: 'claude' }, noPlugins).claudeBin).toBe('/opt/claude')
  })

  it('recentSectionHours is clamped when present, not just kept as `keep` would', () => {
    expect(mergeSettingsPayload(DEFAULT_SETTINGS, { recentSectionHours: 0 }, noPlugins).recentSectionHours).toBe(1)
    expect(mergeSettingsPayload(DEFAULT_SETTINGS, { recentSectionHours: 999 }, noPlugins).recentSectionHours).toBe(168)
  })

  it('recentSectionHours stays put when the payload omits it, unclamped', () => {
    const current = { ...DEFAULT_SETTINGS, recentSectionHours: 12 }
    expect(mergeSettingsPayload(current, {}, noPlugins).recentSectionHours).toBe(12)
  })

  it('pluginSettings drops an id this build does not know about (SEC-8)', () => {
    const merged = mergeSettingsPayload(
      DEFAULT_SETTINGS,
      { pluginSettings: { known: { a: 1 }, unknown: { b: 2 } } },
      new Set(['known']),
    )
    expect(merged.pluginSettings).toEqual({ known: { a: 1 } })
  })

  it('pluginSettings drops a value that is not a string, number or boolean (SEC-8)', () => {
    const merged = mergeSettingsPayload(
      DEFAULT_SETTINGS,
      { pluginSettings: { known: { good: 'x', bad: { nested: true } as unknown as string } } },
      new Set(['known']),
    )
    expect(merged.pluginSettings).toEqual({ known: { good: 'x' } })
  })

  it('applies every field the payload does carry, alongside the ones it omits', () => {
    const merged = mergeSettingsPayload(DEFAULT_SETTINGS, {
      autoImportAll: true,
      plugins: { 'gitlab-mr': false },
      logRetentionDays: 30,
    }, noPlugins)
    expect(merged.autoImportAll).toBe(true)
    expect(merged.plugins).toEqual({ 'gitlab-mr': false })
    expect(merged.logRetentionDays).toBe(30)
    // Untouched fields keep the current settings' values.
    expect(merged.terminalMinimalPrompt).toBe(DEFAULT_SETTINGS.terminalMinimalPrompt)
  })
})

describe('terminalMinimalPrompt', () => {
  it('defaults on, including for an existing settings file that has never stored it', () => {
    expect(DEFAULT_SETTINGS.terminalMinimalPrompt).toBe(true)
    writeFileSync(file(), JSON.stringify({ schemaVersion: SETTINGS_VERSION, terminalShortenPath: true, terminalPathSegments: 1 }))
    expect(loadSettings(file()).terminalMinimalPrompt).toBe(true)
  })
})
