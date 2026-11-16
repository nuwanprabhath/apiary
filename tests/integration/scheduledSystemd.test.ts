import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { systemdScheduler } from '../../src/main/schedule/osScheduler'
import { ScheduledJobs } from '../../src/main/schedule/scheduledJobs'

/**
 * The Linux path for real: an Ubuntu container with systemd as PID 1 and a lingering user, where
 * `systemdScheduler`'s own command lines register a transient user timer, which fires, runs the
 * real script with a stand-in `claude`, and leaves no unit behind. A folder is shared at the same
 * path on both sides, so the files Apiary writes are where the script looks. Needs Docker; runs
 * only with `APIARY_SYSTEMD_E2E=1`. The image carries the label `apiary.test-bed=systemd` and only
 * that label is pruned.
 */
const RUN = process.env.APIARY_SYSTEMD_E2E === '1'
const IMAGE = 'apiary-systemd-bed:latest'
const USER = 'tester'
const UID = '1001'
const docker = (args: string[], timeout = 300_000): string => execFileSync('docker', args, { encoding: 'utf8', timeout })

describe.runIf(RUN)('a scheduled message through a systemd user timer (Ubuntu in Docker)', () => {
  let container = ''
  let root = ''

  beforeAll(() => {
    // Under /tmp itself: Docker Desktop shares it, and the container sees it at the same path.
    root = mkdtempSync('/tmp/apiary-systemd-')
    chmodSync(root, 0o777)
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    docker(['build', '-q', '--build-arg', `TZ=${zone}`, '-t', IMAGE, resolve(__dirname, '../fixtures/systemd')], 900_000)
    container = docker([
      'run', '-d', '--privileged', '--cgroupns=host', '-v', '/sys/fs/cgroup:/sys/fs/cgroup:rw', '--tmpfs', '/run', '--tmpfs', '/run/lock',
      '-v', `${root}:${root}`, '--label', 'apiary.test-bed=systemd', IMAGE,
    ]).trim()
    // Booted, and the lingering user's manager is up.
    for (let i = 0; i < 60; i++) {
      try { docker(['exec', container, 'systemctl', 'is-active', `user@${UID}.service`], 10_000); return } catch { execFileSync('sleep', ['1']) }
    }
    throw new Error('the user manager did not start')
  }, 960_000)

  afterAll(() => {
    if (container !== '') docker(['rm', '-f', container])
    docker(['image', 'prune', '-f', '--filter', 'label=apiary.test-bed=systemd'])
    if (root !== '') rmSync(root, { recursive: true, force: true })
  })

  it('registers, fires, runs the script with the session\'s folder and text, and leaves no unit behind', { timeout: 180_000 }, async () => {
    const userData = join(root, 'userData')
    const cwd = join(root, 'project')
    mkdirSync(cwd, { recursive: true, mode: 0o777 })
    chmodSync(cwd, 0o777)
    const record = join(root, 'calls.txt')
    const claude = join(root, 'claude')
    writeFileSync(claude, `#!/bin/sh\n{ echo "cwd=$(pwd)"; echo "config=$CLAUDE_CONFIG_DIR"; for a in "$@"; do echo "arg=$a"; done; } >> '${record}'\necho replied\n`)
    chmodSync(claude, 0o755)
    const jobs = new ScheduledJobs(userData)
    jobs.install(process.pid)
    jobs.uninstall()
    execFileSync('chmod', ['-R', 'a+rwX', root])
    const asUser = async (file: string, args: string[]): Promise<string> => docker([
      'exec', '-u', USER, '-e', `XDG_RUNTIME_DIR=/run/user/${UID}`, '-e', `DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/${UID}/bus`, container, file, ...args,
    ], 30_000)
    const os = systemdScheduler({ exec: asUser, script: jobs.script, homeDir: '/' })
    expect(await os.available()).toBe(true)

    const id = randomUUID()
    const at = Date.now() + 20_000
    jobs.write(id, { sessionId: '11111111-1111-1111-1111-111111111111', cwd, text: "SCHEDULED it's $HOME", at, claudeBin: claude, shell: '/bin/sh', env: { CLAUDE_CONFIG_DIR: '/acc/work' }, jobKind: 'systemd' })
    execFileSync('chmod', ['-R', 'a+rwX', join(userData, 'scheduled')])
    await os.register(id, at)
    expect(await asUser('systemctl', ['--user', 'list-timers', '--all', '--no-legend'])).toContain(`apiary-scheduled-${id}.timer`)

    await expect.poll(() => jobs.result(id), { timeout: 90_000, interval: 1000 }).not.toBeNull()
    expect(jobs.result(id)).toMatchObject({ code: 0, logTail: 'replied' })
    expect((jobs.result(id)?.at ?? 0) + 1000).toBeGreaterThanOrEqual(Math.floor(at / 1000) * 1000)
    expect(readFileSync(record, 'utf8').trim().split('\n')).toEqual([
      `cwd=${cwd}`, 'config=/acc/work', 'arg=--resume', 'arg=11111111-1111-1111-1111-111111111111', 'arg=-p', 'arg=--', "arg=SCHEDULED it's $HOME",
    ])
    expect(existsSync(join(userData, 'scheduled', `${id}.vars`))).toBe(false)
    await expect.poll(async () => asUser('systemctl', ['--user', 'list-units', '--all', '--no-legend', `apiary-scheduled-${id}*`]), { timeout: 20_000 }).toBe('')
  })
})
