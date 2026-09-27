import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { join } from 'node:path'
import type { AppService } from '../../../src/main/appService'
import { makeSession } from '../../fixtures/makeSession'
import { createServiceFixture, teardownServiceFixture } from './setup'

let home: string
let workdir: string
let service: AppService

beforeEach(() => {
  ;({ home, workdir, service } = createServiceFixture())
})
afterEach(async () => {
  await teardownServiceFixture({ home, workdir, service })
})

const projects = (): string => join(home, '.claude', 'projects')
describe('rebuilding the search index while a pass is already running (MAIN-8)', () => {
  it('re-indexes every session instead of leaving whatever the running pass already walked past', async () => {
    // Enough sessions that the pass (which yields to the event loop between each file) is still
    // partway through when the rebuild is requested, rather than finishing before it starts.
    const total = 30
    const idFor = (i: number): string =>
      `${String(i).padStart(8, '0')}-0000-0000-0000-000000000000`
    for (let i = 0; i < total; i++) {
      makeSession(projects(), `-w${i}`, { sessionId: idFor(i), cwd: workdir, firstPrompt: `marker-${i}` })
    }
    await service.refresh()
    await service.importSessions(Array.from({ length: total }, (_, i) => idFor(i)), [])

    const firstPass = service.updateSearchIndex()
    // Let the pass make some, but not all, progress before rebuilding — the scenario the finding
    // describes: a rebuild clicked while background indexing is still in flight.
    await vi.waitFor(() => {
      expect(service.searchIndexCount()).toBeGreaterThan(0)
      expect(service.searchIndexCount()).toBeLessThan(total)
    }, { timeout: 2000, interval: 1 })

    await service.rebuildSearchIndex()
    await firstPass

    expect(service.searchIndexCount()).toBe(total)
    expect(await service.searchSessions('marker-0')).toEqual([idFor(0)])
    expect(await service.searchSessions(`marker-${total - 1}`)).toEqual([idFor(total - 1)])
  })
})
