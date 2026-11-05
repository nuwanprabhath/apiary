import { describe, it, expect, vi } from 'vitest'
import { cliUpdate, type CliUpdateDeps } from '../../src/main/update/cliUpdate'
import { findRunningApiary, type RunningApiary, type RunningApiaryDeps } from '../../src/main/update/runningApiary'
import type { Command } from '../../src/main/update/installCommands'

const DEB: CliUpdateDeps['capability'] = { kind: 'assisted', reason: 'Installed from a .deb package.' }
const UNIT_CGROUP = '0::/user.slice/user-1000.slice/user@1000.service/app.slice/run-u42.service\n'

/** The command's world: a feed offering `latest`, a download, a terminal that answers each command with `codes`, and what runs. */
function world(over: Partial<CliUpdateDeps> & { latest?: string | null; codes?: (c: Command) => number; runningNow?: RunningApiary | null } = {}) {
  const ran: Array<{ command: Command; env?: Record<string, string> }> = []
  const said: string[] = []
  const removed: string[] = []
  const stop = vi.fn(async () => {})
  const latest = over.latest === undefined ? '1.60.0' : over.latest
  const deps: CliUpdateDeps = {
    currentVersion: '1.56.0',
    platform: 'linux',
    capability: DEB,
    backend: {
      check: async () => (latest === null ? null : { version: latest, releaseNotes: null, releaseUrl: '' }),
      downloadInstaller: async (progress) => { progress(50); progress(100); return '/tmp/apiary_1.60.0_amd64.deb' },
    },
    allowPrerelease: false,
    out: (text) => { said.push(text) },
    run: (command, env) => { ran.push({ command, env }); return over.codes?.(command) ?? 0 },
    running: () => (over.runningNow === undefined ? null : over.runningNow),
    stop,
    removeFile: async (path) => { removed.push(path) },
    execPath: '/opt/Apiary/apiary',
    ownArgs: ['--update'],
    ownEnv: { DISPLAY: undefined, APIARY_X: '1', HOME: '/home/me' },
    ...over,
  }
  return { deps, ran, said: () => said.join(''), removed, stop }
}

const background: RunningApiary = {
  pid: 4242,
  args: ['--background', '--ozone-platform=headless'],
  env: { HOME: '/home/me', XDG_RUNTIME_DIR: '/run/user/1000', SECRET: 'not passed on' },
  cgroup: UNIT_CGROUP,
  parentCgroup: '',
}

describe('apiary --update', () => {
  it('restarts the installed service through systemd when the running Apiary came from it', async () => {
    // Chromium puts its main process in a scope of its own; the parent, which ran it again with no
    // display, is still in apiary.service (seen under real systemd in Docker).
    const fromService = {
      ...background,
      cgroup: '0::/user.slice/user-1000.slice/user@1000.service/app.slice/app-apiary-239.scope\n',
      parentCgroup: '0::/user.slice/user-1000.slice/user@1000.service/app.slice/apiary.service\n',
    }
    const w = world({ runningNow: fromService })
    expect(await cliUpdate(w.deps)).toBe(0)
    expect(w.ran[1].command).toEqual({ file: 'systemctl', args: ['--user', 'restart', '--no-block', 'apiary.service'] })
  })

  it('installs a newer release with apt under sudo in the terminal, deletes the download, and restarts the running Apiary as it was started', async () => {
    const w = world({ runningNow: background })
    expect(await cliUpdate(w.deps)).toBe(0)
    const [apt, relaunch] = w.ran
    expect(apt.command).toEqual({ file: 'sudo', args: ['apt-get', 'install', '-y', '--allow-downgrades', '/tmp/apiary_1.60.0_amd64.deb'] })
    expect(apt.env).toEqual({ DEBIAN_FRONTEND: 'noninteractive' })
    expect(w.removed).toEqual(['/tmp/apiary_1.60.0_amd64.deb'])
    // Under a unit of its own (the old one ran in one), waiting for pid 4242, with its arguments less
    // the no-display switch, which the new one decides for itself, and only the display/bus variables.
    expect(relaunch.command.file).toBe('systemd-run')
    expect(relaunch.command.args).toContain('--setenv=XDG_RUNTIME_DIR=/run/user/1000')
    expect(relaunch.command.args.join(' ')).not.toContain('SECRET')
    expect(relaunch.command.args.slice(-3)).toEqual(['4242', '/opt/Apiary/apiary', '--background'])
    expect(w.stop).toHaveBeenCalledWith(4242)
    expect(w.said()).toContain('Installing Apiary 1.60.0 (sudo may ask for your password)')
    expect(w.said()).toContain('Done: Apiary 1.60.0 is starting.')
  })

  it('starts the new instance before stopping the old one, which holds the lock it waits for', async () => {
    const order: string[] = []
    const w = world({ runningNow: background, codes: (c) => { order.push(c.file); return 0 } })
    w.deps.stop = async () => { order.push('stop') }
    await cliUpdate(w.deps)
    expect(order).toEqual(['sudo', 'systemd-run', 'stop'])
  })

  it('keeps the download and stops when apt fails, leaving the running Apiary alone', async () => {
    const w = world({ runningNow: background, codes: (c) => (c.file === 'sudo' ? 100 : 0) })
    expect(await cliUpdate(w.deps)).toBe(100)
    expect(w.removed).toEqual([])
    expect(w.ran).toHaveLength(1)
    expect(w.stop).not.toHaveBeenCalled()
    expect(w.said()).toContain('The download is kept at /tmp/apiary_1.60.0_amd64.deb')
  })

  it('says so and installs nothing when this is the newest version; with --background it starts one if none runs', async () => {
    const up = world({ latest: '1.56.0' })
    expect(await cliUpdate(up.deps)).toBe(0)
    expect(up.ran).toEqual([])
    expect(up.said()).toContain('Apiary 1.56.0 is the newest version.')

    const start = world({ latest: '1.56.0', ownArgs: ['--update', '--background', '--user-data-dir=/u'] })
    expect(await cliUpdate(start.deps)).toBe(0)
    expect(start.ran.map((r) => r.command)).toEqual([{
      file: 'systemd-run',
      args: ['--user', '--collect', '--quiet', '--setenv=APIARY_X=1', '/opt/Apiary/apiary', '--background', '--user-data-dir=/u'],
    }])
    expect(start.said()).toContain('Started Apiary in the background.')
  })

  it('falls back to its own session when there is no user systemd to start it under', async () => {
    const w = world({ latest: null, ownArgs: ['--background', '--update'], codes: (c) => (c.file === 'systemd-run' ? 1 : 0) })
    expect(await cliUpdate(w.deps)).toBe(0)
    expect(w.ran.map((r) => r.command.file)).toEqual(['systemd-run', 'setsid'])
    expect(w.ran[1].command.args).toEqual(['-f', '/opt/Apiary/apiary', '--background'])
  })

  it('leaves a running Apiary alone when --background finds one already there', async () => {
    const w = world({ latest: '1.56.0', ownArgs: ['--update', '--background'], runningNow: background })
    expect(await cliUpdate(w.deps)).toBe(0)
    expect(w.ran).toEqual([])
    expect(w.said()).toContain('Apiary is already running (pid 4242).')
  })

  it('refuses where the banner is the way to update: a Mac or an AppImage', async () => {
    const mac = world({ platform: 'darwin', capability: { kind: 'assisted', reason: 'Unsigned build.' } })
    expect(await cliUpdate(mac.deps)).toBe(1)
    const appImage = world({ capability: { kind: 'auto', reason: 'AppImage — updates install themselves.' } })
    expect(await cliUpdate(appImage.deps)).toBe(1)
    expect(appImage.said()).toContain('Use the update banner')
    expect(mac.ran).toEqual([])
  })

  it('says what failed when the feed cannot be reached', async () => {
    const w = world()
    w.deps.backend = { ...w.deps.backend, check: async () => { throw new Error('getaddrinfo ENOTFOUND api.github.com') } }
    expect(await cliUpdate(w.deps)).toBe(1)
    expect(w.said()).toContain('Could not check for updates: getaddrinfo ENOTFOUND api.github.com')
  })
})

describe('finding the running Apiary', () => {
  const proc = (files: Partial<Record<'cmdline' | 'environ' | 'cgroup' | 'status', string>>): RunningApiaryDeps['readProc'] =>
    (_pid, file) => files[file] ?? null
  const deps = (over: Partial<RunningApiaryDeps>): RunningApiaryDeps => ({
    readLock: () => 'work-pc-4242',
    readProc: proc({ cmdline: '/opt/Apiary/apiary\0--background\0', environ: 'HOME=/home/me\0DISPLAY=:0\0', cgroup: UNIT_CGROUP }),
    alive: () => true,
    host: 'work-pc',
    ...over,
  })

  it('reads the pid from the profile\'s lock, and the process\'s arguments, environment, cgroup and its parent\'s', () => {
    expect(findRunningApiary('/u', deps({}))).toEqual({
      pid: 4242, args: ['--background'], env: { HOME: '/home/me', DISPLAY: ':0' }, cgroup: UNIT_CGROUP, parentCgroup: '',
    })
    const withParent = deps({
      readProc: (pid, file) => (file === 'status' ? 'Name:\tapiary\nPPid:\t212\n' : file === 'cgroup' ? `cgroup-of-${String(pid)}` : file === 'cmdline' ? 'apiary\0' : ''),
    })
    expect(findRunningApiary('/u', withParent)).toMatchObject({ cgroup: 'cgroup-of-4242', parentCgroup: 'cgroup-of-212' })
  })

  it('reads the arguments of a main process whose title Chromium rewrote: one string, joined by spaces', () => {
    const rewritten = deps({ readProc: proc({ cmdline: '/opt/Apiary/apiary --no-sandbox --user-data-dir=/home/dev/ud --background', environ: '' }) })
    expect(findRunningApiary('/u', rewritten)?.args).toEqual(['--no-sandbox', '--user-data-dir=/home/dev/ud', '--background'])
  })

  it('finds none with no lock, a lock from another machine, or a pid that has gone', () => {
    expect(findRunningApiary('/u', deps({ readLock: () => null }))).toBeNull()
    expect(findRunningApiary('/u', deps({ readLock: () => 'laptop-4242' }))).toBeNull()
    expect(findRunningApiary('/u', deps({ alive: () => false }))).toBeNull()
  })

  it('takes the host from everything before the last dash, so a host name with dashes still matches', () => {
    expect(findRunningApiary('/u', deps({ host: 'nuwan-HP', readLock: () => 'nuwan-HP-131820' }))?.pid).toBe(131820)
  })
})
