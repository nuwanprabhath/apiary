import { describe, it, expect } from 'vitest'
import { UpdateService, type UpdateBackend, type UpdateStatus, type PreviousInstall } from '../../src/main/update/updateService'
import type { CapabilityInput } from '../../src/main/update/capability'
import { PASSWORD_NOT_ACCEPTED, type InstallOutcome } from '@shared/domain/update'

/**
 * Install and restart, driven against a stub backend: download, ask whether sudo needs a password,
 * install, restart, and every way that can stop short.
 */

const debPackage: CapabilityInput = { platform: 'linux', packaged: true, appImagePath: undefined, macSigned: false }
const appImage: CapabilityInput = { platform: 'linux', packaged: true, appImagePath: '/tmp/Apiary.AppImage', macSigned: false }

class StubBackend implements UpdateBackend {
  calls: string[] = []
  sudoPassword: string | null = null
  installFailure: string | null = null
  verified = true
  previous: PreviousInstall | null = null
  passwordsSeen: (string | null)[] = []
  passwordRequired = false

  async check() { return { version: '1.51.0', releaseNotes: null, releaseUrl: null } }
  async downloadForInstall() { this.calls.push('downloadForInstall') }
  install() { this.calls.push('install') }
  async downloadInstaller(onProgress: (p: number) => void) {
    this.calls.push('download')
    onProgress(62)
    return '/tmp/apiary_1.51.0_amd64.deb'
  }
  async openInstaller() { this.calls.push('open'); return { ok: 'opened' as const } }
  async needsPassword() { this.calls.push('needsPassword'); return this.sudoPassword !== null }
  async stillVerified() { this.calls.push('stillVerified'); return this.verified }
  async installDownloaded(_path: string, { password }: { password: string | null }): Promise<InstallOutcome> {
    this.calls.push('installDownloaded')
    this.passwordsSeen.push(password)
    if (this.sudoPassword !== null && password !== this.sudoPassword) return { ok: false, reason: 'password', message: PASSWORD_NOT_ACCEPTED }
    if (this.passwordRequired && password === null) return { ok: false, reason: 'password-required', message: '' }
    if (this.installFailure !== null) return { ok: false, reason: 'install', message: this.installFailure }
    return { ok: true }
  }
  restart() { this.calls.push('restart') }
  relaunch() { this.calls.push('relaunch') }
  async takePreviousInstall() { return this.previous }
}

function harness(capabilityInput: CapabilityInput = debPackage) {
  const backend = new StubBackend()
  const statuses: UpdateStatus[] = []
  const service = new UpdateService({
    currentVersion: '1.50.0',
    capabilityInput,
    backend,
    settings: () => ({ automaticChecks: false, checkIntervalHours: 6, autoDownload: false, allowPrerelease: false, skippedVersion: null }),
    saveSettings: () => {},
    onStatus: (s) => { statuses.push(s) },
  })
  return { service, backend, statuses, phases: () => statuses.map((s) => s.phase) }
}

async function offered(capabilityInput: CapabilityInput = debPackage) {
  const h = harness(capabilityInput)
  await h.service.check({ manual: true })
  h.statuses.length = 0
  return h
}

describe('Install and restart', () => {
  it('from available downloads, then installs, then restarts, and never opens the installer', async () => {
    const { service, backend, phases, statuses } = await offered()
    expect(await service.prepareInstall()).toEqual({ needsPassword: false })
    expect(backend.calls).toEqual(['download', 'needsPassword', 'stillVerified', 'installDownloaded', 'restart'])
    expect(phases()).toContain('downloading')
    expect(statuses.find((s) => s.phase === 'downloading')?.installRequested).toBe(true)
    expect(phases().slice(-2)).toEqual(['installing', 'restarting'])
    expect(backend.passwordsSeen).toEqual([null])
  })

  it('waits for a password when sudo wants one, and installs with it', async () => {
    const { service, backend } = await offered()
    backend.sudoPassword = 'hunter2'
    expect(await service.prepareInstall()).toEqual({ needsPassword: true })
    expect(service.current().phase).toBe('needs-password')
    expect(backend.calls).not.toContain('installDownloaded')
    expect(await service.installAndRestart('hunter2')).toEqual({ ok: true })
    expect(service.current().phase).toBe('restarting')
    expect(backend.calls.at(-1)).toBe('restart')
  })

  it('a wrong password returns to the password prompt without restarting', async () => {
    const { service, backend } = await offered()
    backend.sudoPassword = 'hunter2'
    await service.prepareInstall()
    expect(await service.installAndRestart('nope')).toMatchObject({ ok: false, reason: 'password' })
    expect(service.current()).toMatchObject({ phase: 'needs-password', installError: PASSWORD_NOT_ACCEPTED })
    expect(backend.calls).not.toContain('restart')
  })

  it('sudo wanting a password after all (the cache expired) asks for one without saying it was refused', async () => {
    const { service, backend } = await offered()
    backend.passwordRequired = true
    expect(await service.prepareInstall()).toEqual({ needsPassword: false })
    expect(service.current()).toMatchObject({ phase: 'needs-password', installError: null })
    expect(backend.calls).not.toContain('restart')
  })

  it('an install failure keeps the file, offers it by hand, and does not restart', async () => {
    const { service, backend } = await offered()
    backend.installFailure = 'E: dpkg was interrupted'
    await service.prepareInstall()
    expect(service.current()).toMatchObject({
      phase: 'downloaded', installError: 'E: dpkg was interrupted', downloadedPath: '/tmp/apiary_1.51.0_amd64.deb',
    })
    expect(service.current().install?.command).toContain('apt install')
    expect(backend.calls).not.toContain('restart')
  })

  it('is refused in any other phase, and for an installation that updates itself', async () => {
    const idle = harness()
    expect(await idle.service.prepareInstall()).toEqual({ needsPassword: false })
    expect(await idle.service.installAndRestart('x')).toMatchObject({ ok: false, reason: 'install' })
    expect(idle.backend.calls).toEqual([])

    const offeredApp = await offered()
    expect(await offeredApp.service.installAndRestart('x')).toMatchObject({ ok: false })
    expect(offeredApp.backend.calls).toEqual([])

    const auto = await offered(appImage)
    await auto.service.prepareInstall()
    expect(auto.backend.calls).toEqual([])
  })

  it('refuses a file that changed since it was verified, and downloads it again next time', async () => {
    const { service, backend } = await offered()
    backend.verified = false
    await service.prepareInstall()
    expect(backend.calls).not.toContain('installDownloaded')
    expect(service.current()).toMatchObject({ phase: 'available', downloadedPath: null })
    expect(service.current().installError).toContain('changed since it was verified')
  })

  it('Cancel on the password prompt goes back to the offer, keeping the file for another try', async () => {
    const { service, backend } = await offered()
    backend.sudoPassword = 'hunter2'
    await service.prepareInstall()
    service.dismiss()
    expect(service.current()).toMatchObject({ phase: 'available', installError: null })
    backend.calls.length = 0
    await service.prepareInstall()
    expect(backend.calls).toEqual(['needsPassword'])
  })

  it('the password never appears in any status it emits', async () => {
    const { service, backend, statuses } = await offered()
    backend.sudoPassword = 'correct-horse-7'
    await service.prepareInstall()
    await service.installAndRestart('wrong-staple-9')
    await service.installAndRestart('correct-horse-7')
    const sent = JSON.stringify(statuses)
    expect(sent).not.toContain('correct-horse-7')
    expect(sent).not.toContain('wrong-staple-9')
  })

  it('at the next start, shows a failed install after quit with the kept installer, and says nothing of a success', async () => {
    const failed = harness({ platform: 'darwin', packaged: true, appImagePath: undefined, macSigned: false })
    failed.backend.previous = { version: '1.51.0', ok: false, message: 'The disk image could not be opened.', path: '/tmp/Apiary-1.51.0.dmg' }
    await failed.service.restorePreviousInstall()
    expect(failed.service.current()).toMatchObject({
      phase: 'downloaded', availableVersion: '1.51.0', downloadedPath: '/tmp/Apiary-1.51.0.dmg', installError: 'The disk image could not be opened.',
    })

    const worked = harness()
    worked.backend.previous = { version: '1.51.0', ok: true, message: '', path: null }
    await worked.service.restorePreviousInstall()
    expect(worked.statuses).toEqual([])
  })
})
