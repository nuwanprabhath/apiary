import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createExportService, type ExportServiceDeps } from '../../../src/main/privacy/exportService'

let root: string
const NOW = Date.UTC(2026, 10, 25, 12)

const deps = (over: Partial<ExportServiceDeps> = {}): ExportServiceDeps => ({
  pickFolder: async () => root,
  now: () => NOW,
  digests: () => [{ sessionId: 's1', topic: { title: 'Auth' } }],
  residents: () => [{ id: 'regent', history: () => [{ id: '1', role: 'user', text: 'hi', at: 1, streaming: false }], notes: () => ({ k: 'v' }) }],
  settings: () => ({ theme: 'x', gdprStrictMode: true }),
  ...over,
})

beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'apiary-export-test-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

const mode = (p: string): number => statSync(p).mode & 0o777

describe('the export', () => {
  it('writes digests, residents, settings and a README into a private dated folder', async () => {
    const dir = await createExportService(deps()).export()
    expect(dir).toBe(join(root, 'apiary-export-2026-11-25'))
    if (dir === null) return
    expect(readdirSync(dir).sort()).toEqual(['README.txt', 'digests.json', 'residents', 'settings.json'])
    expect(JSON.parse(readFileSync(join(dir, 'digests.json'), 'utf8'))).toEqual([{ sessionId: 's1', topic: { title: 'Auth' } }])
    expect(JSON.parse(readFileSync(join(dir, 'residents', 'regent', 'notes.json'), 'utf8'))).toEqual({ k: 'v' })
    expect(JSON.parse(readFileSync(join(dir, 'residents', 'regent', 'history.json'), 'utf8'))).toHaveLength(1)
    expect(mode(dir)).toBe(0o700)
    expect(mode(join(dir, 'residents', 'regent'))).toBe(0o700)
    for (const f of ['README.txt', 'digests.json', 'settings.json', 'residents/regent/history.json']) expect(mode(join(dir, f))).toBe(0o600)
  })

  it('writes no token', async () => {
    const dir = await createExportService(deps()).export()
    if (dir === null) throw new Error('no export')
    const all = ['digests.json', 'settings.json', 'residents/regent/history.json'].map((f) => readFileSync(join(dir, f), 'utf8')).join('')
    expect(all).not.toMatch(/xox[a-z]-|token/i)
  })

  it('does nothing when the person cancels the dialog', async () => {
    expect(await createExportService(deps({ pickFolder: async () => null })).export()).toBeNull()
    expect(readdirSync(root)).toEqual([])
  })
})
