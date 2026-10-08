import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { writeFileSync, readFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { buildAppService } from '../../fixtures/buildService'
import type { AppService } from '../../../src/main/appService'
import { makeSession } from '../../fixtures/makeSession'
import { createServiceFixture, teardownServiceFixture } from './setup'
import { asSessionId } from '@shared/domain/ids'

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
describe('resuming a session that already has a pty', () => {
  it('attaches to it instead of respawning — two windows both resuming a restored session must not race', async () => {
    // The scenario this covers: a session recorded `live` at quit can legitimately have been open
    // in two windows at once. On relaunch each window's renderer calls resume() independently —
    // neither can see what the other has already started, since each is its own process. Without
    // this check, the second call would hit `spawn()`'s unconditional `kill()` and restart the pty
    // out from under the first window mid-startup. `fake-claude.sh` records one line per time it
    // is actually launched, so a second `resume()` producing no second line is the proof.
    const started = join(home, 'started.log')
    const fakeClaude = join(home, 'fake-claude.sh')
    writeFileSync(fakeClaude, `#!/bin/sh\necho spawned >> ${JSON.stringify(started)}\nexec sleep 100\n`)
    chmodSync(fakeClaude, 0o755)

    const resumeService = buildAppService({
      configRoot: join(home, '.claude'),
      dbPath: join(home, 'apiary-resume.db'),
      detectLive: async () => new Map(),
      claudeBin: fakeClaude,
    })
    try {
      makeSession(projects(), '-w', {
        sessionId: '55555555-5555-5555-5555-555555555555', cwd: workdir, title: 'Two windows',
      })
      await resumeService.refresh()
      await resumeService.importSessions(['55555555-5555-5555-5555-555555555555'], [])

      await resumeService.resume(asSessionId('55555555-5555-5555-5555-555555555555'))
      await vi.waitFor(() => {
        expect(readFileSync(started, 'utf8').trim().split('\n')).toHaveLength(1)
      })
      // The second window's mount effect, calling resume() for the same restored session id.
      await resumeService.resume(asSessionId('55555555-5555-5555-5555-555555555555'))

      // No second launch — the check is synchronous with spawn, so there is nothing to wait for.
      expect(readFileSync(started, 'utf8').trim().split('\n')).toHaveLength(1)
      expect(resumeService.pty.has('55555555-5555-5555-5555-555555555555')).toBe(true)
    } finally {
      await resumeService.dispose()
    }
  })
})
