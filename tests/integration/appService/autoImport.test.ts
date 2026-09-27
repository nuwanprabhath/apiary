import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'node:path'
import { AppService } from '../../../src/main/appService'
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
describe('auto-import all', () => {
  it('importAllDiscovered marks all unimported sessions as imported and returns count', async () => {
    makeSession(projects(), '-w', {
      sessionId: '11111111-1111-1111-1111-111111111111', cwd: workdir, title: 'First',
    })
    makeSession(projects(), '-w', {
      sessionId: '22222222-2222-2222-2222-222222222222', cwd: workdir, title: 'Second',
    })
    await service.refresh()

    // Neither session is imported yet.
    let discovered = await service.discovered()
    expect(discovered.filter((s) => !s.imported)).toHaveLength(2)
    expect(discovered.filter((s) => s.imported)).toHaveLength(0)

    // importAllDiscovered marks all unimported sessions as imported.
    const count = await service.importAllDiscovered()
    expect(count).toBe(2)

    discovered = await service.discovered()
    expect(discovered.filter((s) => s.imported)).toHaveLength(2)

    // Calling it again returns 0 since everything is already imported.
    const secondCount = await service.importAllDiscovered()
    expect(secondCount).toBe(0)
  })

  it('refresh with autoImportAll enabled imports newly discovered sessions', async () => {
    // Create service with autoImportAll enabled.
    const autoService = new AppService({
      configRoot: join(home, '.claude'),
      dbPath: join(home, 'apiary-auto.db'),
      autoImportAll: true,
      detectLive: async () => new Map(),
    })
    try {
      makeSession(projects(), '-w', {
        sessionId: '33333333-3333-3333-3333-333333333333', cwd: workdir, title: 'Auto-imported 1',
      })
      await autoService.refresh()

      // After refresh, the session should be automatically imported since autoImportAll is on.
      let tree = await autoService.tree()
      expect(tree).toHaveLength(1)
      expect(tree[0].sessions[0].title).toBe('Auto-imported 1')

      // New session discovered after the first refresh should also be auto-imported.
      makeSession(projects(), '-w2', {
        sessionId: '44444444-4444-4444-4444-444444444444', cwd: workdir, title: 'Auto-imported 2',
      })
      await autoService.refresh()

      tree = await autoService.tree()
      expect(tree[0].sessions.map((s) => s.title).sort()).toEqual([
        'Auto-imported 1',
        'Auto-imported 2',
      ])
    } finally {
      await autoService.dispose()
    }
  })
})
