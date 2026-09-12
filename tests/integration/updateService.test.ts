import { describe, it, expect, beforeEach } from 'vitest'
import {
  UpdateService, FIRST_CHECK_DELAY_MS,
  type UpdateBackend, type UpdateSettings, type UpdateStatus, type FeedResult,
} from '../../src/main/update/updateService'
import type { CapabilityInput } from '../../src/main/update/capability'

/**
 * The updater's behaviour, driven against a stub backend and a clock the test owns.
 *
 * This is where the rules are actually verified: the real thing cannot be exercised without
 * publishing a release, so anything not pinned here is not pinned anywhere.
 */

/** A controllable stand-in for the network and the installer. */
class StubBackend implements UpdateBackend {
  feed: FeedResult | null = { version: '1.9.0', releaseNotes: 'notes', releaseUrl: 'url' }
  checkError: Error | null = null
  downloadError: Error | null = null
  checks = 0
  downloads = 0
  installs = 0
  opened: string[] = []
  lastAllowPrerelease = false

  async check({ allowPrerelease }: { allowPrerelease: boolean }): Promise<FeedResult | null> {
    this.checks += 1
    this.lastAllowPrerelease = allowPrerelease
    if (this.checkError !== null) throw this.checkError
    return this.feed
  }

  async downloadForInstall(onProgress: (p: number) => void): Promise<void> {
    this.downloads += 1
    if (this.downloadError !== null) throw this.downloadError
    onProgress(50)
    onProgress(100)
  }

  install(): void { this.installs += 1 }

  async downloadInstaller(onProgress: (p: number) => void): Promise<string> {
    this.downloads += 1
    if (this.downloadError !== null) throw this.downloadError
    onProgress(100)
    return '/tmp/Apiary-1.9.0.dmg'
  }

  async openInstaller(path: string): Promise<void> { this.opened.push(path) }
}

/** A clock the test advances by hand, so schedules are tested without waiting for them. */
class FakeClock {
  private time = 1_000_000
  private queue: { at: number; fn: () => void; id: number }[] = []
  private nextId = 1

  timers = {
    setTimeout: (fn: () => void, ms: number): number => {
      const id = this.nextId++
      this.queue.push({ at: this.time + ms, fn, id })
      return id
    },
    clearTimeout: (handle: NodeJS.Timeout | number): void => {
      this.queue = this.queue.filter((t) => t.id !== handle)
    },
    now: (): number => this.time,
  }

  /** Runs everything due within `ms`, in order, then settles pending promises. */
  async advance(ms: number): Promise<void> {
    this.time += ms
    for (;;) {
      const due = this.queue.filter((t) => t.at <= this.time).sort((a, b) => a.at - b.at)
      if (due.length === 0) break
      const next = due[0]
      this.queue = this.queue.filter((t) => t.id !== next.id)
      next.fn()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    }
  }

  pending(): number { return this.queue.length }
}

const macUnsigned: CapabilityInput = {
  platform: 'darwin', packaged: true, appImagePath: undefined, macSigned: false,
}
const appImage: CapabilityInput = {
  platform: 'linux', packaged: true, appImagePath: '/tmp/Apiary.AppImage', macSigned: false,
}

interface Harness {
  service: UpdateService
  backend: StubBackend
  clock: FakeClock
  settings: UpdateSettings
  statuses: UpdateStatus[]
  saved: Partial<UpdateSettings>[]
}

function harness(
  capabilityInput: CapabilityInput = appImage,
  overrides: Partial<UpdateSettings> = {},
): Harness {
  const backend = new StubBackend()
  const clock = new FakeClock()
  const settings: UpdateSettings = {
    automaticChecks: true,
    checkIntervalHours: 6,
    autoDownload: false,
    allowPrerelease: false,
    skippedVersion: null,
    ...overrides,
  }
  const statuses: UpdateStatus[] = []
  const saved: Partial<UpdateSettings>[] = []
  const service = new UpdateService({
    currentVersion: '1.8.2',
    capabilityInput,
    backend,
    settings: () => settings,
    saveSettings: (patch) => {
      saved.push(patch)
      Object.assign(settings, patch)
    },
    onStatus: (s) => statuses.push(s),
    timers: clock.timers,
  })
  return { service, backend, clock, settings, statuses, saved }
}

let h: Harness
beforeEach(() => { h = harness() })

describe('checking', () => {
  it('offers an update it finds', async () => {
    const status = await h.service.check({ manual: true })
    expect(status.phase).toBe('available')
    expect(status.availableVersion).toBe('1.9.0')
  })

  it('a manual check that finds nothing says so; a scheduled one stays quiet', async () => {
    h.backend.feed = { version: '1.8.2', releaseNotes: null, releaseUrl: null }
    expect((await h.service.check({ manual: true })).phase).toBe('up-to-date')
    expect((await h.service.check({ manual: false })).phase).toBe('idle')
  })

  it('records when it last checked, even when there was nothing to report', async () => {
    h.backend.feed = null
    const status = await h.service.check({ manual: false })
    expect(status.lastCheckedAt).not.toBeNull()
  })

  it('turns a network failure into a status rather than an exception', async () => {
    h.backend.checkError = new Error('getaddrinfo ENOTFOUND github.com')
    const status = await h.service.check({ manual: true })
    expect(status.phase).toBe('error')
    expect(status.error).toContain('ENOTFOUND')
  })

  it('does not run two checks at once', async () => {
    await Promise.all([h.service.check({ manual: false }), h.service.check({ manual: false })])
    expect(h.backend.checks).toBe(1)
  })

  it('passes the pre-release preference through to the feed', async () => {
    const withBetas = harness(appImage, { allowPrerelease: true })
    await withBetas.service.check({ manual: true })
    expect(withBetas.backend.lastAllowPrerelease).toBe(true)
  })

  it('does nothing at all where there is no update mechanism', async () => {
    const dev = harness({ ...appImage, packaged: false })
    await dev.service.check({ manual: false })
    expect(dev.backend.checks).toBe(0)
  })
})

describe('skipping', () => {
  it('stops offering that version, and remembers it through the settings', async () => {
    await h.service.check({ manual: false })
    h.service.skip()
    expect(h.saved).toEqual([{ skippedVersion: '1.9.0' }])

    const after = await h.service.check({ manual: false })
    expect(after.phase).toBe('idle')
  })

  it('still offers the next release after the one that was skipped', async () => {
    await h.service.check({ manual: false })
    h.service.skip()
    h.backend.feed = { version: '1.9.1', releaseNotes: null, releaseUrl: null }
    expect((await h.service.check({ manual: false })).phase).toBe('available')
  })

  it('a manual check answers honestly about a version that was skipped', async () => {
    // "Check for Updates" saying "up to date" when it is not would be a lie, however politely
    // the version was dismissed earlier.
    await h.service.check({ manual: false })
    h.service.skip()
    expect((await h.service.check({ manual: true })).phase).toBe('available')
  })
})

describe('downloading', () => {
  it('stages an update on a platform that can install itself, and installs on request', async () => {
    await h.service.check({ manual: false })
    const status = await h.service.download()
    expect(status.phase).toBe('ready')
    expect(status.progressPercent).toBe(100)

    h.service.install()
    expect(h.backend.installs).toBe(1)
  })

  it('saves the installer and opens it where the app cannot install itself', async () => {
    const mac = harness(macUnsigned)
    await mac.service.check({ manual: false })
    const status = await mac.service.download()

    expect(status.phase).toBe('downloaded')
    expect(status.downloadedPath).toBe('/tmp/Apiary-1.9.0.dmg')
    expect(mac.backend.opened).toEqual(['/tmp/Apiary-1.9.0.dmg'])
    // And it never tries to install, which is the step that would fail on an unsigned bundle.
    expect(mac.backend.installs).toBe(0)
  })

  it('refuses to install when nothing has been staged', async () => {
    await h.service.check({ manual: false })
    h.service.install()
    expect(h.backend.installs).toBe(0)
  })

  it('goes back to offering the update when the download fails, so it can be retried', async () => {
    await h.service.check({ manual: false })
    h.backend.downloadError = new Error('socket hang up')
    const status = await h.service.download()

    expect(status.phase).toBe('available')
    expect(status.error).toContain('socket hang up')
    expect(status.availableVersion).toBe('1.9.0')

    h.backend.downloadError = null
    expect((await h.service.download()).phase).toBe('ready')
  })

  it('reports progress as it goes', async () => {
    await h.service.check({ manual: false })
    await h.service.download()
    expect(h.statuses.map((s) => s.progressPercent)).toContain(50)
  })

  it('downloads on its own only when that was asked for', async () => {
    await h.service.check({ manual: false })
    expect(h.backend.downloads).toBe(0)

    const eager = harness(appImage, { autoDownload: true })
    expect((await eager.service.check({ manual: false })).phase).toBe('ready')
    expect(eager.backend.downloads).toBe(1)
  })
})

describe('the schedule', () => {
  it('waits before the first check rather than competing with startup', async () => {
    h.service.start()
    await h.clock.advance(FIRST_CHECK_DELAY_MS - 1000)
    expect(h.backend.checks).toBe(0)

    await h.clock.advance(2000)
    expect(h.backend.checks).toBe(1)
  })

  it('keeps checking on the interval', async () => {
    h.service.start()
    await h.clock.advance(FIRST_CHECK_DELAY_MS)
    await h.clock.advance(6 * 60 * 60 * 1000)
    expect(h.backend.checks).toBe(2)
  })

  it('does not schedule anything when automatic checks are off', async () => {
    const off = harness(appImage, { automaticChecks: false })
    off.service.start()
    await off.clock.advance(FIRST_CHECK_DELAY_MS * 10)
    expect(off.backend.checks).toBe(0)
  })

  it('takes a settings change immediately, rather than at the next check', async () => {
    const off = harness(appImage, { automaticChecks: false })
    off.service.start()
    off.settings.automaticChecks = true
    off.service.settingsChanged()

    await off.clock.advance(FIRST_CHECK_DELAY_MS)
    expect(off.backend.checks).toBe(1)

    off.settings.automaticChecks = false
    off.service.settingsChanged()
    await off.clock.advance(24 * 60 * 60 * 1000)
    expect(off.backend.checks).toBe(1)
  })

  it('clamps a nonsense interval instead of scheduling a check every few milliseconds', async () => {
    const silly = harness(appImage, { checkIntervalHours: 0 })
    silly.service.start()
    await silly.clock.advance(FIRST_CHECK_DELAY_MS)
    await silly.clock.advance(59 * 60 * 1000)
    expect(silly.backend.checks).toBe(1)
    await silly.clock.advance(2 * 60 * 1000)
    expect(silly.backend.checks).toBe(2)
  })

  it('stops cleanly, leaving no timer behind', async () => {
    h.service.start()
    h.service.stop()
    await h.clock.advance(FIRST_CHECK_DELAY_MS * 5)
    expect(h.backend.checks).toBe(0)
    expect(h.clock.pending()).toBe(0)
  })

  it('never schedules a check on a platform that could not act on the answer', () => {
    const dev = harness({ ...appImage, packaged: false })
    dev.service.start()
    expect(dev.clock.pending()).toBe(0)
  })
})

describe('dismissing', () => {
  it('clears the notice without recording a skip, so the next check offers it again', async () => {
    await h.service.check({ manual: false })
    h.service.dismiss()
    expect(h.service.current().phase).toBe('idle')
    expect(h.saved).toEqual([])

    expect((await h.service.check({ manual: false })).phase).toBe('available')
  })

  it('leaves a download in progress alone', async () => {
    await h.service.check({ manual: false })
    await h.service.download()
    h.service.dismiss()
    // Still ready to install: dismissing the banner is not cancelling the update.
    expect(h.service.current().phase).toBe('ready')
  })
})
