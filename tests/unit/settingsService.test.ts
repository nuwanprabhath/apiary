import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SettingsService } from '../../src/main/settings/settingsService'
import { DEFAULT_SETTINGS } from '../../src/main/settings'

let dir: string
const file = () => join(dir, 'settings.json')

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apiary-settings-service-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('SettingsService', () => {
  it('loads defaults and writes them back once at construction', () => {
    const service = new SettingsService(file())
    expect(service.get()).toEqual(DEFAULT_SETTINGS)
    expect(JSON.parse(readFileSync(file(), 'utf8'))).toEqual(DEFAULT_SETTINGS)
  })

  it('patch updates the in-memory copy and persists it', () => {
    const service = new SettingsService(file())
    service.patch({ claudeBin: '/opt/claude' })
    expect(service.get().claudeBin).toBe('/opt/claude')
    const onDisk = JSON.parse(readFileSync(file(), 'utf8')) as { claudeBin: string }
    expect(onDisk.claudeBin).toBe('/opt/claude')
  })

  it('applyPayload treats a missing field as unchanged, never as off', () => {
    const service = new SettingsService(file())
    service.patch({ searchChatContent: true })
    service.applyPayload({}, new Set())
    expect(service.get().searchChatContent).toBe(true)
  })

  it('applyPayload rejects an unknown plugin id and clamps numeric fields', () => {
    const service = new SettingsService(file())
    const merged = service.applyPayload(
      { recentSectionHours: 999, pluginSettings: { unknown: { a: 1 }, known: { b: 2 } } },
      new Set(['known']),
    )
    expect(merged.recentSectionHours).toBe(168)
    expect(merged.pluginSettings).toEqual({ known: { b: 2 } })
  })

  it('notifies onChange subscribers with next and prev, and unsubscribes cleanly', () => {
    const service = new SettingsService(file())
    const calls: Array<{ next: boolean; prev: boolean }> = []
    const unsubscribe = service.onChange((next, prev) => {
      calls.push({ next: next.autoImportAll, prev: prev.autoImportAll })
    })
    service.patch({ autoImportAll: true })
    unsubscribe()
    service.patch({ autoImportAll: false })
    expect(calls).toEqual([{ next: true, prev: false }])
  })
})
