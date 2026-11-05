import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { run, type Run } from '../remote/harness'
import { MAC_FREE_BYTES_JXA, parseDfFreeKb, parseFreeBytesAsKb } from '../remote/diskGuard'

/**
 * Install and restart for real on Ubuntu 24.04 (`npm run test:update-deb`): apt installs this
 * checkout's .deb V, the app is started under the bed's `systemd-run` shim with the fake updater
 * offering V+0.0.1 (a real .deb), and the banner is pressed over CDP. The bed has no real systemd,
 * so `/proc/self/cgroup` puts the app under no user unit and the relaunch takes the `setsid` path.
 */
const IMAGE = 'apiary-update-test'
const LABEL = 'apiary.test-bed=update'
const REPO = resolve(import.meta.dirname, '../..')
const PASSWORD = 'Upd4te-s3cret-never-logged'
/** Below this the Docker disk fills mid-build; the maintainer's limit for this Mac. */
const MIN_FREE_GB = 4
const enabled = process.env.APIARY_UPDATE_E2E === '1'

async function must(args: string[], timeoutMs?: number): Promise<string> {
  const r = await run('docker', args, timeoutMs)
  if (r.code !== 0) throw new Error(`docker ${args.slice(0, 3).join(' ')} failed (${String(r.code)}): ${r.stderr.slice(-3000)}${r.stdout.slice(-3000)}`)
  return r.stdout.trim()
}

async function freeGb(): Promise<number | undefined> {
  const mac = process.platform === 'darwin' ? parseFreeBytesAsKb((await run('osascript', ['-l', 'JavaScript', '-e', MAC_FREE_BYTES_JXA])).stdout) : undefined
  const kb = mac ?? parseDfFreeKb((await run('df', ['-k', homedir()])).stdout)
  return kb === undefined ? undefined : kb / 1024 / 1024
}

let container = ''
let next = ''
const sh = (script: string, user = 'root'): Promise<Run> => run('docker', ['exec', '-u', user, container, 'sh', '-c', script], 180_000)

/** The installed Apiary's main process (no Chromium `--type=`), or null. */
async function mainPid(): Promise<number | null> {
  const r = await sh("ps -eo pid=,args= | grep '^ *[0-9]* /opt/Apiary/apiary ' | grep -v -- '--type=' | head -n 1")
  const pid = Number(r.stdout.trim().split(/\s+/)[0])
  return Number.isInteger(pid) && pid > 0 ? pid : null
}

async function waitFor<T>(read: () => Promise<T | null>, what: string, timeoutMs = 120_000): Promise<T> {
  const until = Date.now() + timeoutMs
  for (;;) {
    const value = await read()
    if (value !== null) return value
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`)
    await run('sleep', ['1'])
  }
}

async function startCase(sudoers: string): Promise<number> {
  // --init: a real machine's init reaps the old app; `sleep` as pid 1 would leave it a zombie that
  // `kill -0` still finds, so the relaunch helper would wait for it forever.
  container = await must(['run', '-d', '--init', '--label', LABEL, IMAGE])
  next = (await sh('cat /debs/next-version')).stdout.trim()
  const setup = await sh([
    `printf 'dev:%s\\n' '${PASSWORD}' | chpasswd`,
    `printf '%s\\n' '${sudoers}' > /etc/sudoers.d/dev && chmod 440 /etc/sudoers.d/dev`,
    'mkdir -p /home/dev/ud && printf \'{"diagnosticsEnabled":true,"plugins":{"claude-usage":false}}\' > /home/dev/ud/settings.json',
    'chown -R dev:dev /home/dev/ud',
  ].join(' && '))
  expect(setup.code, setup.stderr).toBe(0)
  const start = await sh(`export APIARY_FAKE_UPDATE=${next} APIARY_FAKE_UPDATE_MODE=deb APIARY_FAKE_UPDATE_FILE=/debs/apiary-next.deb; start-apiary`, 'dev')
  expect(start.code, start.stderr).toBe(0)
  return waitFor(mainPid, 'the installed Apiary to start')
}

async function drive(wrong: string, right: string): Promise<Run> {
  return run('docker', ['exec', '-u', 'dev', container, 'node', '/app/tests/update/docker/drive.mjs', wrong, right], 400_000)
}

async function assertUpdated(oldPid: number): Promise<void> {
  const status = await waitFor(async () => {
    const r = await sh("dpkg-query -W -f='${Version}' apiary")
    return r.stdout.trim() === next ? r.stdout.trim() : null
  }, `dpkg to show ${next}`)
  expect(status).toBe(next)
  const newPid = await waitFor(async () => {
    const pid = await mainPid()
    return pid !== null && pid !== oldPid ? pid : null
  }, 'a new Apiary process').catch(async (e: unknown) => {
    const seen = await sh("ps -eo pid,stat,args | grep -v ' --type=' | head -n 30; grep -rh '\"update\"' /home/dev/ud/logs | tail -n 15")
    throw new Error(`${String(e)}\n${seen.stdout}`)
  })
  expect(newPid).not.toBe(oldPid)
  // The new process logs its version at start ("started", with `version`).
  await waitFor(async () => ((await sh(`grep -rl '${next}' /home/dev/ud/logs`)).stdout.trim() !== '' ? true : null), `a log line from ${next}`)
  expect((await sh('ls /home/dev/Downloads/*.deb 2>/dev/null | wc -l')).stdout.trim()).toBe('0')
  const leaked = await sh(`grep -rl '${PASSWORD}' /home/dev/ud/logs /home/dev/app.out`)
  expect(leaked.stdout.trim()).toBe('')
}

describe.skipIf(!enabled)('Install and restart from an installed .deb on Ubuntu 24.04', () => {
  beforeAll(async () => {
    await must(['info'])
    const free = await freeGb()
    if (free !== undefined && free < MIN_FREE_GB) throw new Error(`Refusing to build: ${free.toFixed(1)} GiB free, need ${String(MIN_FREE_GB)}`)
    await must(['build', '--progress=plain', '-t', IMAGE, '-f', 'tests/update/docker/Dockerfile', REPO], 3_600_000)
  }, 3_600_000)

  afterEach(async () => {
    if (container !== '') await run('docker', ['rm', '-f', container])
    container = ''
  })

  afterAll(async () => {
    // Only this bed's label: dangling images and build cache from earlier builds of it.
    await run('docker', ['image', 'prune', '-f', '--filter', `label=${LABEL}`])
    await run('docker', ['builder', 'prune', '-f', '--filter', `label=${LABEL}`])
  })

  it('asks for the password, refuses a wrong one, installs with the right one and restarts into the new version', async () => {
    const oldPid = await startCase('dev ALL=(ALL) ALL')
    const driven = await drive('not-the-password', PASSWORD)
    expect(driven.code, driven.stdout + driven.stderr).toBe(0)
    expect(driven.stdout).toContain('wrong password refused')
    await assertUpdated(oldPid)
  }, 600_000)

  it('apiary --update from a shell with no display installs the new version and restarts the background Apiary headless', async () => {
    // As over SSH with nobody at the desktop: a background Apiary with no display, then the update
    // typed in a terminal. NOPASSWD, because `docker exec` has no terminal for sudo to ask on.
    container = await must(['run', '-d', '--init', '--label', LABEL, IMAGE])
    next = (await sh('cat /debs/next-version')).stdout.trim()
    const setup = await sh([
      "printf 'dev ALL=(ALL) NOPASSWD:ALL\\n' > /etc/sudoers.d/dev && chmod 440 /etc/sudoers.d/dev",
      'mkdir -p /home/dev/ud && printf \'{"diagnosticsEnabled":true,"remoteAccess":true,"plugins":{"claude-usage":false}}\' > /home/dev/ud/settings.json',
      'chown -R dev:dev /home/dev/ud',
    ].join(' && '))
    expect(setup.code, setup.stderr).toBe(0)
    const flags = '--no-sandbox --disable-gpu --user-data-dir=/home/dev/ud'
    const started = await sh(`unset DISPLAY WAYLAND_DISPLAY; systemd-run --user --collect /opt/Apiary/apiary ${flags} --background`, 'dev')
    expect(started.code, started.stderr).toBe(0)
    const oldPid = await waitFor(async () => {
      const r = await sh("ps -eo pid=,args= | grep -- '--ozone-platform=headless' | grep -v -- '--type=' | grep -v grep | head -n 1")
      const pid = Number(r.stdout.trim().split(/\s+/)[0])
      return Number.isInteger(pid) && pid > 0 ? pid : null
    }, 'the background Apiary to start with no display')
    await waitFor(async () => ((await sh('test -S /home/dev/.apiary/remote.sock && echo y', 'dev')).stdout.trim() === 'y' ? true : null), 'its remote socket')

    const updated = await sh(
      `unset DISPLAY WAYLAND_DISPLAY; APIARY_FAKE_UPDATE=${next} APIARY_FAKE_UPDATE_MODE=deb APIARY_FAKE_UPDATE_FILE=/debs/apiary-next.deb /opt/Apiary/apiary ${flags} --update 2>/dev/null`,
      'dev',
    )
    expect(updated.code, updated.stdout + updated.stderr).toBe(0)
    expect(updated.stdout).toContain(`Installing Apiary ${next}`)
    expect(updated.stdout).toContain(`Done: Apiary ${next} is starting.`)
    expect((await sh("dpkg-query -W -f='${Version}' apiary")).stdout.trim()).toBe(next)

    const newPid = await waitFor(async () => {
      const r = await sh("ps -eo pid=,args= | grep -- '--ozone-platform=headless' | grep -- '--background' | grep -v -- '--type=' | grep -v grep | head -n 1")
      const pid = Number(r.stdout.trim().split(/\s+/)[0])
      return Number.isInteger(pid) && pid > 0 && pid !== oldPid ? pid : null
    }, 'the new version to start in the background, headless')
    expect(newPid).not.toBe(oldPid)
    await waitFor(async () => ((await sh(`grep -rl '${next}' /home/dev/ud/logs`)).stdout.trim() !== '' ? true : null), `a log line from ${next}`)
    await waitFor(async () => ((await sh('test -S /home/dev/.apiary/remote.sock && echo y', 'dev')).stdout.trim() === 'y' ? true : null), 'the new version\'s remote socket')
    expect((await sh('ls /home/dev/Downloads/*.deb 2>/dev/null | wc -l')).stdout.trim()).toBe('0')
  }, 600_000)

  it('with NOPASSWD sudo, installs and restarts without asking', async () => {
    const oldPid = await startCase('dev ALL=(ALL) NOPASSWD:ALL')
    const driven = await drive('-', '-')
    expect(driven.code, driven.stdout + driven.stderr).toBe(0)
    expect(driven.stdout).toContain('no password asked')
    await assertUpdated(oldPid)
  }, 600_000)
})
