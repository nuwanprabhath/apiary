import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PurgeRequest } from '@shared/domain/privacy'
import { createPurgeService, type PurgeTarget } from '../../../src/main/privacy/purgeService'
import { ImageStore } from '../../../src/main/media/imageStore'
import { ScheduledJobs } from '../../../src/main/schedule/scheduledJobs'

let root: string
let userData: string
let claudeRoot: string

const ALL: PurgeRequest = {
  searchIndex: true, digests: true, logs: true, residentHistory: true,
  slackMessages: true, pastedImages: true, scheduledLogs: true, sessionMetadata: true,
}

const emptying = (dir: string): PurgeTarget => ({
  paths: [dir],
  run: async () => { for (const n of existsSync(dir) ? readdirSync(dir) : []) rmSync(join(dir, n), { recursive: true, force: true }) },
})

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'apiary-purge-'))
  userData = join(root, 'userData')
  claudeRoot = join(root, 'dot-claude')
  mkdirSync(join(claudeRoot, 'projects', 'p'), { recursive: true })
  writeFileSync(join(claudeRoot, 'projects', 'p', 'sentinel.jsonl'), '{"keep":true}\n')
  for (const d of ['logs', 'pasted-images', 'scheduled', 'residents/regent']) mkdirSync(join(userData, d), { recursive: true })
})
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('the purge', () => {
  it('empties every store asked for, measures what went, and never touches the Claude config root', async () => {
    writeFileSync(join(userData, 'logs', 'apiary.log'), 'x'.repeat(100))
    writeFileSync(join(userData, 'pasted-images', 'a.png'), 'y'.repeat(50))
    writeFileSync(join(userData, 'scheduled', 'a.log'), 'z'.repeat(10))
    writeFileSync(join(userData, 'scheduled', 'p.vars'), 'v')
    writeFileSync(join(userData, 'residents', 'regent', 'history.json'), '{}')
    const jobs = new ScheduledJobs(userData)
    const images = new ImageStore({ dir: join(userData, 'pasted-images') })
    const service = createPurgeService({
      roots: [userData],
      targets: {
        searchIndex: { paths: [], run: async () => undefined },
        digests: { paths: [], run: async () => undefined },
        logs: emptying(join(userData, 'logs')),
        residentHistory: emptying(join(userData, 'residents')),
        slackMessages: { paths: [], run: async () => undefined },
        pastedImages: { paths: [join(userData, 'pasted-images')], run: async () => { await images.clear() } },
        scheduledLogs: { paths: [join(userData, 'scheduled')], run: async () => { jobs.clearLogs() } },
        sessionMetadata: { paths: [], run: async () => undefined },
      },
    })
    const result = await service.purge(ALL)
    expect(result.failed).toEqual([])
    expect(result.removedBytes).toBe(100 + 50 + 10 + 2)
    expect(readdirSync(join(userData, 'logs'))).toEqual([])
    expect(readdirSync(join(userData, 'scheduled'))).toEqual(['p.vars'])
    expect(existsSync(join(claudeRoot, 'projects', 'p', 'sentinel.jsonl'))).toBe(true)
  })

  it('refuses a target that leads into the Claude config root, and reports it', async () => {
    symlinkSync(claudeRoot, join(userData, 'linked'))
    let ran = false
    const none = { paths: [], run: async () => undefined }
    const result = await createPurgeService({
      roots: [userData],
      targets: {
        searchIndex: none, digests: none, residentHistory: none, slackMessages: none, scheduledLogs: none, sessionMetadata: none,
        logs: { paths: [join(userData, 'linked')], run: async () => { ran = true } },
        pastedImages: { paths: [claudeRoot], run: async () => { ran = true } },
      },
    }).purge(ALL)
    expect(ran).toBe(false)
    expect(result.failed.map((f) => f.item).sort()).toEqual(['logs', 'pastedImages'])
    expect(existsSync(join(claudeRoot, 'projects', 'p', 'sentinel.jsonl'))).toBe(true)
  })

  it('reports each failing item and carries on with the rest', async () => {
    writeFileSync(join(userData, 'logs', 'apiary.log'), 'x')
    const none = { paths: [], run: async () => undefined }
    const result = await createPurgeService({
      roots: [userData],
      targets: {
        searchIndex: { paths: [], run: async () => { throw new Error('index busy') } },
        digests: null, residentHistory: none, slackMessages: none, scheduledLogs: none, sessionMetadata: none, pastedImages: none,
        logs: emptying(join(userData, 'logs')),
      },
    }).purge(ALL)
    expect(result.failed).toEqual([
      { item: 'searchIndex', reason: 'index busy' },
      { item: 'digests', reason: 'Not available here.' },
    ])
    expect(readdirSync(join(userData, 'logs'))).toEqual([])
  })

  it('trusts every folder the app keeps its data in, such as the session database\'s, and nothing else', async () => {
    const dbDir = join(root, 'db-elsewhere')
    mkdirSync(dbDir)
    writeFileSync(join(dbDir, 'search.db'), 'i'.repeat(40))
    const outside = join(root, 'not-ours')
    mkdirSync(outside)
    writeFileSync(join(outside, 'keep.txt'), 'k')
    const none = { paths: [], run: async () => undefined }
    const result = await createPurgeService({
      roots: [userData, dbDir],
      targets: {
        digests: none, residentHistory: none, slackMessages: none, scheduledLogs: none, sessionMetadata: none, logs: none,
        searchIndex: { paths: [join(dbDir, 'search.db')], run: async () => { rmSync(join(dbDir, 'search.db')) } },
        pastedImages: emptying(outside),
      },
    }).purge(ALL)
    expect(existsSync(join(dbDir, 'search.db'))).toBe(false)
    expect(result.removedBytes).toBe(40)
    expect(result.failed.map((f) => f.item)).toEqual(['pastedImages'])
    expect(existsSync(join(outside, 'keep.txt'))).toBe(true)
  })

  it('does only what was asked', async () => {
    writeFileSync(join(userData, 'logs', 'apiary.log'), 'x')
    const none = { paths: [], run: async () => undefined }
    await createPurgeService({
      roots: [userData],
      targets: { searchIndex: none, digests: none, residentHistory: none, slackMessages: none, scheduledLogs: none, sessionMetadata: none, pastedImages: none, logs: emptying(join(userData, 'logs')) },
    }).purge({ ...ALL, logs: false })
    expect(readdirSync(join(userData, 'logs'))).toEqual(['apiary.log'])
  })
})
