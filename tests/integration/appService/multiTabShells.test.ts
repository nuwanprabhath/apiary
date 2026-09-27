import { describe, it, expect, beforeEach, afterEach } from 'vitest'
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
describe('multi-tab shells', () => {
  it('spawns distinct ptys for two tabs of the same session', async () => {
    makeSession(projects(), '-w', {
      sessionId: '11111111-1111-1111-1111-111111111111', cwd: workdir, title: 'Fix CSV export',
    })
    await service.refresh()
    await service.importSessions(['11111111-1111-1111-1111-111111111111'], [])

    await service.openShell('11111111-1111-1111-1111-111111111111', '1')
    await service.openShell('11111111-1111-1111-1111-111111111111', '2')
    expect(service.pty.has('shell:11111111-1111-1111-1111-111111111111:1')).toBe(true)
    expect(service.pty.has('shell:11111111-1111-1111-1111-111111111111:2')).toBe(true)
  })

  it('attaches to a shell that is already running rather than replacing it', async () => {
    // Shell tab ids are minted per window and the first is always `1`, so a session open in two
    // windows asked for the very same pty id — and `spawn` kills whatever is under an id before
    // taking it. A build, a `tail -f` or an editor running in the first window's shell died the
    // moment a second window showed that session, with nothing said about it.
    makeSession(projects(), '-w', {
      sessionId: '22222222-2222-2222-2222-222222222222', cwd: workdir, title: 'Shared shell',
    })
    await service.refresh()
    await service.importSessions(['22222222-2222-2222-2222-222222222222'], [])
    const id = 'shell:22222222-2222-2222-2222-222222222222:1'

    await service.openShell('22222222-2222-2222-2222-222222222222', '1')
    // Something running in that shell, which must survive the second window opening it.
    service.pty.write(id, 'MARKER=alive\n')
    await service.openShell('22222222-2222-2222-2222-222222222222', '1')

    service.pty.write(id, 'echo "still:$MARKER"\n')
    const seen = await new Promise<string>((resolve) => {
      let buffer = ''
      service.pty.onData((gotId, data) => {
        if (gotId !== id) return
        buffer += data
        if (buffer.includes('still:alive')) resolve(buffer)
      })
    })
    expect(seen).toContain('still:alive')
  })
})
