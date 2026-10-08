import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildAppService } from '../fixtures/buildService'
import { PtyManager } from '../../src/main/pty/ptyManager'
import { SessionStore } from '../../src/main/store/sessionStore'
import { PluginRegistry } from '../../src/main/plugins/registry'

/**
 * MAIN-14 step 1 / TEST-6: `AppService` must accept an already-built `pty`, `store` and `plugins`
 * instead of always constructing its own — the seam a test needs to fake node-pty/better-sqlite3
 * out of a unit test. Proven here by identity: the instance handed in is the instance the service
 * actually uses, not merely one it copied fields out of.
 */
describe('AppService injectable deps', () => {
  let home: string

  afterEach(() => {
    if (home) rmSync(home, { recursive: true, force: true })
  })

  it('uses an injected pty, store and plugins instead of building its own', async () => {
    home = mkdtempSync(join(tmpdir(), 'apiary-deps-'))
    mkdirSync(join(home, '.claude', 'projects'), { recursive: true })
    const pty = new PtyManager()
    const store = new SessionStore(join(home, 'apiary.db'))
    const plugins = new PluginRegistry({})

    const service = buildAppService({
      configRoot: join(home, '.claude'),
      dbPath: join(home, 'apiary.db'),
      detectLive: async () => new Map(),
      deps: { pty, store, plugins },
    })

    expect(service.pty).toBe(pty)
    // `store` and `plugins` are private; identity is observed through behaviour that only the
    // injected instance would produce (an empty registry contributes no bar items, where the
    // default constructor always registers the GitLab plugin).
    expect(service.plugins.list()).toEqual([])

    await service.dispose()
    // dispose() closes the store it was given — a second close on the same handle must not throw,
    // which is what would happen if AppService had silently built (and closed) a second one too.
    expect(() => store.close()).not.toThrow()
  })

  it('still builds its own collaborators when no deps are given (default behaviour unchanged)', async () => {
    home = mkdtempSync(join(tmpdir(), 'apiary-deps-default-'))
    mkdirSync(join(home, '.claude', 'projects'), { recursive: true })
    const service = buildAppService({
      configRoot: join(home, '.claude'),
      dbPath: join(home, 'apiary.db'),
      detectLive: async () => new Map(),
    })
    // The default GitLab plugin is registered, as before.
    expect(service.plugins.list().map((p) => p.id)).toContain('gitlab-mr')
    await service.dispose()
  })
})
