import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadSettings, saveSettings, DEFAULT_SETTINGS } from '../../src/main/settings'

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
      claudeBin: '/opt/claude',
      autoImportAll: true,
      autoImportIntervalMinutes: 30,
      revealActiveInSidebar: false,
      searchChatContent: false,
      updateAutomaticChecks: false,
      updateCheckIntervalHours: 24,
      updateAutoDownload: true,
      updateAllowPrerelease: true,
      updateSkippedVersion: '1.9.0',
      windowBounds: bounds,
    })
    expect(loadSettings(file())).toEqual({
      claudeBin: '/opt/claude',
      autoImportAll: true,
      autoImportIntervalMinutes: 30,
      revealActiveInSidebar: false,
      searchChatContent: false,
      updateAutomaticChecks: false,
      updateCheckIntervalHours: 24,
      updateAutoDownload: true,
      updateAllowPrerelease: true,
      updateSkippedVersion: '1.9.0',
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
