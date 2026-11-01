import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PASSWORD_NOT_ACCEPTED } from '@shared/domain/update'

/**
 * The Ubuntu install, with sudo replaced by a fake child: where the password goes (stdin, nowhere
 * else), how a refusal is told from an apt failure, and that the .deb is deleted only on success.
 */
interface Spawned { file: string; args: string[]; options: Record<string, unknown>; stdin: string }
const spawned: Spawned[] = []
let reply: { code: number; stderr: string } = { code: 0, stderr: '' }

function fakeChild(record: Spawned) {
  const child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    stdin: Object.assign(new EventEmitter(), {
      end: (data: string) => {
        record.stdin = data
        setImmediate(() => {
          if (reply.stderr !== '') child.stderr.emit('data', Buffer.from(reply.stderr))
          child.emit('close', reply.code)
        })
      },
    }),
    kill: () => true,
    unref: () => {},
  })
  return child
}

vi.mock('node:child_process', () => ({
  spawn: (file: string, args: string[], options: Record<string, unknown>) => {
    const record: Spawned = { file, args, options, stdin: '' }
    spawned.push(record)
    return fakeChild(record)
  },
  execFile: (_f: string, _a: string[], _o: unknown, cb: (e: Error | null, out: string, err: string) => void) => { cb(new Error('a password is required'), '', '') },
}))

const { createPlatformInstaller, hashFile } = await import('../../src/main/update/platformInstaller')
const { UpdateService } = await import('../../src/main/update/updateService')
const { createFakeUpdateBackend } = await import('../../src/main/update/fakeBackend')
const { log } = await import('../../src/main/log/logger')

const PASSWORD = 'pa55-W0RD-never-logged'
let dir: string
let deb: string
let logged: unknown[]

beforeEach(async () => {
  spawned.length = 0
  reply = { code: 0, stderr: '' }
  dir = await mkdtemp(join(tmpdir(), 'apiary-install-test-'))
  deb = join(dir, 'apiary_1.51.0_arm64.deb')
  await writeFile(deb, 'not really a deb')
  logged = []
  vi.spyOn(log, 'log').mockImplementation((...args: unknown[]) => { logged.push(args) })
})

afterEach(async () => {
  vi.restoreAllMocks()
  await rm(dir, { recursive: true, force: true })
})

function installer() {
  return createPlatformInstaller({ platform: 'linux', resultFile: join(dir, 'update-result.json'), quit: () => {} })
}

describe('installing a .deb', () => {
  it('sends the password only on stdin, then deletes the .deb', async () => {
    const i = installer()
    i.recordVerified(deb, await hashFile(deb))
    expect(await i.stillVerified(deb)).toBe(true)
    expect(await i.installDownloaded(deb, { password: PASSWORD, version: '1.51.0' })).toEqual({ ok: true })
    expect(spawned).toHaveLength(1)
    expect(spawned[0].file).toBe('sudo')
    expect(spawned[0].stdin).toBe(`${PASSWORD}\n`)
    expect(JSON.stringify(spawned[0].args)).not.toContain(PASSWORD)
    expect((spawned[0].options.env as Record<string, string>).DEBIAN_FRONTEND).toBe('noninteractive')
    await expect(stat(deb)).rejects.toThrow()
    expect(await i.stillVerified(deb)).toBe(false)
  })

  it('a refused password is a password failure, and keeps the .deb', async () => {
    reply = { code: 1, stderr: 'Sorry, try again.\nsudo: 1 incorrect password attempt\n' }
    expect(await installer().installDownloaded(deb, { password: 'wrong', version: '1.51.0' }))
      .toEqual({ ok: false, reason: 'password', message: PASSWORD_NOT_ACCEPTED })
    expect((await stat(deb)).isFile()).toBe(true)
  })

  it('with no password, sudo -n runs it and reads nothing, so a cached sudo is not asked again', async () => {
    expect(await installer().installDownloaded(deb, { password: null, version: '1.51.0' })).toEqual({ ok: true })
    expect(spawned[0].args.slice(0, 2)).toEqual(['-n', 'apt-get'])
    expect(spawned[0].args).not.toContain('-S')
    expect(spawned[0].stdin).toBe('')
  })

  it('sudo -n wanting a password after all is "password required", not a refused password', async () => {
    reply = { code: 1, stderr: 'sudo: a password is required\n' }
    expect(await installer().installDownloaded(deb, { password: null, version: '1.51.0' }))
      .toEqual({ ok: false, reason: 'password-required', message: '' })
  })

  it('an apt failure is an install failure in apt\'s last line, and keeps the .deb', async () => {
    reply = { code: 100, stderr: 'Reading package lists...\nE: dpkg was interrupted, you must manually run \'dpkg --configure -a\'\n' }
    expect(await installer().installDownloaded(deb, { password: null, version: '1.51.0' }))
      .toEqual({ ok: false, reason: 'install', message: 'E: dpkg was interrupted, you must manually run \'dpkg --configure -a\'' })
    expect((await stat(deb)).isFile()).toBe(true)
  })

  it('the password is in no log line and no status, through a wrong try and a right one', async () => {
    const i = installer()
    const backend = createFakeUpdateBackend({ fake: '1.51.0', fakeMode: 'deb', fakeFile: { path: deb, downloadDir: join(dir, 'downloads'), installer: i } })
    const statuses: unknown[] = []
    const service = new UpdateService({
      currentVersion: '1.50.0',
      capabilityInput: { platform: 'linux', packaged: true, appImagePath: undefined, macSigned: false },
      backend,
      settings: () => ({ automaticChecks: false, checkIntervalHours: 6, autoDownload: false, allowPrerelease: false, skippedVersion: null }),
      saveSettings: () => {},
      onStatus: (s) => { statuses.push(s) },
    })
    await service.check({ manual: true })
    expect(await service.prepareInstall()).toEqual({ needsPassword: true })
    reply = { code: 1, stderr: 'sudo: 1 incorrect password attempt\n' }
    await service.installAndRestart(`${PASSWORD}-typo`)
    expect(service.current().phase).toBe('needs-password')
    reply = { code: 0, stderr: '' }
    await service.installAndRestart(PASSWORD)
    expect(service.current().phase).toBe('restarting')
    expect(spawned.filter((s) => s.file === 'sudo').map((s) => s.stdin)).toEqual([`${PASSWORD}-typo\n`, `${PASSWORD}\n`])
    // The restart: a helper that waits for this pid, carrying no secret either.
    await vi.waitFor(() => { expect(spawned.some((s) => s.file === 'setsid')).toBe(true) })
    expect(JSON.stringify(spawned.map((s) => s.args))).not.toContain(PASSWORD)
    expect(logged.length).toBeGreaterThan(0)
    expect(JSON.stringify(logged)).not.toContain(PASSWORD)
    expect(JSON.stringify(statuses)).not.toContain(PASSWORD)
  })
})

describe('a macOS app run from a quarantined copy', () => {
  it('refuses before asking for a password: App Translocation made the bundle read-only', async () => {
    const i = createPlatformInstaller({
      platform: 'darwin', resultFile: join(dir, 'update-result.json'), quit: () => {},
      execPath: '/private/var/folders/xy/T/AppTranslocation/1A2B/d/Apiary.app/Contents/MacOS/Apiary',
    })
    await expect(i.needsPassword(deb)).rejects.toThrow(/quarantined copy macOS made read-only.*xattr -cr/)
  })
})

describe('macOS: the helper that installs after quit', () => {
  async function bundleIn(parent: string): Promise<string> {
    const { mkdir } = await import('node:fs/promises')
    await mkdir(join(parent, 'Apiary.app', 'Contents', 'MacOS'), { recursive: true })
    return join(parent, 'Apiary.app', 'Contents', 'MacOS', 'Apiary')
  }
  function mac(execPath: string, quit: () => void = () => {}) {
    return createPlatformInstaller({ platform: 'darwin', resultFile: join(dir, 'update-result.json'), quit, execPath })
  }

  it('needs no password where this user can write the bundle and its folder', async () => {
    expect(await mac(await bundleIn(dir)).needsPassword(deb)).toBe(false)
  })

  it('refuses an executable that is not inside an app bundle', async () => {
    await expect(mac('/usr/local/bin/apiary').needsPassword(deb)).rejects.toThrow(/app bundle/)
    expect(await mac('/usr/local/bin/apiary').installDownloaded(deb, { password: null, version: '1.51.0' }))
      .toEqual({ ok: false, reason: 'install', message: 'Apiary is not running from an app bundle.' })
  })

  it('with no password, starts the helper unprivileged, never through sudo', async () => {
    expect(await mac(await bundleIn(dir)).installDownloaded(deb, { password: null, version: '1.51.0' })).toEqual({ ok: true })
    expect(spawned.map((s) => s.file)).toEqual(['/bin/sh'])
    expect(spawned[0].options.detached).toBe(true)
  })

  it('with a password, checks it first, then starts the helper under sudo with the password on stdin only', async () => {
    expect(await mac(await bundleIn(dir)).installDownloaded(deb, { password: PASSWORD, version: '1.51.0' })).toEqual({ ok: true })
    expect(spawned.map((s) => [s.file, s.args.includes('-v')])).toEqual([['sudo', true], ['sudo', false]])
    expect(spawned.map((s) => s.stdin)).toEqual([`${PASSWORD}\n`, `${PASSWORD}\n`])
    expect(JSON.stringify(spawned.map((s) => s.args))).not.toContain(PASSWORD)
  })

  it('a refused password is reported before quitting, and no helper starts', async () => {
    reply = { code: 1, stderr: 'Sorry, try again.\n' }
    expect(await mac(await bundleIn(dir)).installDownloaded(deb, { password: 'wrong', version: '1.51.0' }))
      .toEqual({ ok: false, reason: 'password', message: PASSWORD_NOT_ACCEPTED })
    expect(spawned).toHaveLength(1)
  })

  it('sudo failing for another reason is an install failure in its own words', async () => {
    reply = { code: 1, stderr: 'sudo: unable to resolve host\n' }
    expect(await mac(await bundleIn(dir)).installDownloaded(deb, { password: 'x', version: '1.51.0' }))
      .toEqual({ ok: false, reason: 'install', message: 'sudo: unable to resolve host' })
  })

  it('restart only quits: the helper relaunches once Apiary has gone', async () => {
    const quit = vi.fn()
    mac(await bundleIn(dir), quit).restart()
    expect(quit).toHaveBeenCalledOnce()
    expect(spawned).toEqual([])
  })
})

describe('the result the macOS helper leaves for the next start', () => {
  const resultFile = (): string => join(dir, 'update-result.json')

  it('is read once and deleted, with the kept installer when it is still there', async () => {
    await writeFile(resultFile(), JSON.stringify({ version: '1.51.0', ok: false, message: 'The disk image could not be opened.', path: deb }))
    const i = installer()
    expect(await i.takePreviousInstall()).toEqual({ version: '1.51.0', ok: false, message: 'The disk image could not be opened.', path: deb })
    await expect(stat(resultFile())).rejects.toThrow()
    expect(await i.takePreviousInstall()).toBeNull()
  })

  it('drops a kept path that is gone, and treats a torn file as none', async () => {
    await writeFile(resultFile(), JSON.stringify({ version: '1.51.0', ok: true, message: '', path: join(dir, 'gone.dmg') }))
    expect(await installer().takePreviousInstall()).toEqual({ version: '1.51.0', ok: true, message: '', path: null })
    await writeFile(resultFile(), '{"version":')
    expect(await installer().takePreviousInstall()).toBeNull()
    await writeFile(resultFile(), JSON.stringify({ version: 1 }))
    expect(await installer().takePreviousInstall()).toBeNull()
  })
})

describe('the platforms Install and restart does not cover', () => {
  it('Linux asks sudo whether a password is needed; Windows cannot install', async () => {
    expect(await installer().needsPassword(deb)).toBe(true)
    const win = createPlatformInstaller({ platform: 'win32', resultFile: join(dir, 'r.json'), quit: () => {} })
    expect(await win.installDownloaded(deb, { password: null, version: '1.51.0' }))
      .toEqual({ ok: false, reason: 'install', message: 'Apiary cannot install updates on win32.' })
  })
})
