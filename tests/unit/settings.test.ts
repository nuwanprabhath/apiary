import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  loadSettings, saveSettings, DEFAULT_SETTINGS, migrateSettings, SETTINGS_VERSION,
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
      terminalShortenPath: true,
      terminalPathSegments: 3,
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
      terminalShortenPath: true,
      terminalPathSegments: 3,
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
