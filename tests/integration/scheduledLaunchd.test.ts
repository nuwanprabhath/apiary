import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createExec } from '../../src/main/exec/run'
import { launchdScheduler } from '../../src/main/schedule/osScheduler'
import { ScheduledJobs } from '../../src/main/schedule/scheduledJobs'

/**
 * The real launchd path on this Mac, end to end: a LaunchAgent in `~/Library/LaunchAgents` fires a
 * minute or so ahead, runs the real script with a stand-in `claude`, and removes itself. It touches
 * the user's launchd, so it runs only when asked (`APIARY_LAUNCHD_E2E=1`, never in CI), and removes
 * its job whatever happens.
 */
const RUN = process.platform === 'darwin' && process.env.APIARY_LAUNCHD_E2E === '1'

describe.runIf(RUN)('a scheduled message through launchd', () => {
  it('fires at its minute with Apiary closed, sends, records .done and removes its LaunchAgent', { timeout: 240_000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), 'launchd-e2e-'))
    const userData = join(root, 'userData')
    const cwd = join(root, 'project')
    mkdirSync(cwd, { recursive: true })
    const record = join(root, 'calls.txt')
    const claude = join(root, 'claude')
    writeFileSync(claude, `#!/bin/sh\n{ echo "cwd=$(pwd)"; for a in "$@"; do echo "arg=$a"; done; } >> '${record}'\n`)
    chmodSync(claude, 0o755)
    const id = randomUUID()
    const jobs = new ScheduledJobs(userData)
    const os = launchdScheduler({ exec: createExec({ scope: 'schedule', timeoutMs: 15_000 }), script: jobs.script, homeDir: homedir(), uid: process.getuid?.() ?? 0 })
    const plist = join(homedir(), 'Library', 'LaunchAgents', `com.apiary.scheduled.${id}.plist`)
    try {
      jobs.install(process.pid)
      jobs.uninstall()
      const at = Date.now() + 75_000
      jobs.write(id, { sessionId: '11111111-1111-1111-1111-111111111111', cwd, text: 'SCHEDULED', at, claudeBin: claude, shell: '/bin/sh', env: {}, jobKind: 'launchd' })
      await os.register(id, at)
      expect(existsSync(plist)).toBe(true)
      await expect.poll(() => jobs.result(id), { timeout: 200_000, interval: 2000 }).not.toBeNull()
      const sentAt = jobs.result(id)?.at ?? 0
      expect(sentAt).toBeGreaterThanOrEqual(Math.floor(at / 1000) * 1000)
      expect(readFileSync(record, 'utf8')).toContain('arg=--resume\narg=11111111-1111-1111-1111-111111111111\narg=-p\narg=--\narg=SCHEDULED\n')
      await expect.poll(() => existsSync(plist), { timeout: 20_000 }).toBe(false)
      const listed = await createExec()('launchctl', ['list'], root)
      expect(listed).not.toContain(`com.apiary.scheduled.${id}`)
    } finally {
      await os.remove(id)
    }
  })
})
