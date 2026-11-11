import { describe, it, expect } from 'vitest'
import {
  UpdateService, INSTALLED_FIRST_CHECK_DELAY_MS, INSTALLED_CHECK_INTERVAL_MS, INSTALLED_FOCUS_THROTTLE_MS,
  type UpdateBackend, type UpdateStatus,
} from '../../src/main/update/updateService'
import { readInstalledVersion, plistVersion, type InstalledVersionInput } from '../../src/main/update/installedVersion'

/** A newer package installed under the running app: the checker, with a clock the test owns. */

function setup(read: () => Promise<string | null>) {
  let now = 1_000
  const timeouts: { at: number; fn: () => void; id: number }[] = []
  let nextId = 1
  const restarts: number[] = []
  const statuses: UpdateStatus[] = []
  const backend = {
    check: async () => null,
    restart: () => { throw new Error('the installed copy is started with relaunch, not restart') },
    relaunch: () => { restarts.push(1) },
  } as unknown as UpdateBackend
  const service = new UpdateService({
    currentVersion: '1.59.14',
    capabilityInput: { platform: 'linux', packaged: true, appImagePath: undefined, macSigned: false },
    backend,
    settings: () => ({ automaticChecks: false, checkIntervalHours: 6, autoDownload: false, allowPrerelease: false, skippedVersion: null }),
    saveSettings: () => {},
    onStatus: (s) => statuses.push(s),
    installedVersion: read,
    timers: {
      setTimeout: (fn, ms) => { const id = nextId++; timeouts.push({ at: now + ms, fn, id }); return id },
      clearTimeout: (h) => { const i = timeouts.findIndex((t) => t.id === h); if (i >= 0) timeouts.splice(i, 1) },
      now: () => now,
    },
  })
  const advance = async (ms: number): Promise<void> => {
    now += ms
    for (const t of timeouts.filter((x) => x.at <= now)) {
      timeouts.splice(timeouts.indexOf(t), 1)
      t.fn()
    }
    for (let i = 0; i < 10; i += 1) await Promise.resolve()
  }
  return { service, advance, restarts, statuses }
}

describe('a newer Apiary installed under the running one', () => {
  it('is noticed after a minute, then every ten', async () => {
    let installed: string | null = '1.59.14'
    const t = setup(async () => installed)
    t.service.start()
    await t.advance(INSTALLED_FIRST_CHECK_DELAY_MS)
    expect(t.service.current().installedVersion).toBeNull()
    installed = '1.60.39'
    await t.advance(INSTALLED_CHECK_INTERVAL_MS)
    expect(t.service.current().installedVersion).toBe('1.60.39')
  })

  it('same, older and unreadable show nothing', async () => {
    for (const read of [async () => '1.59.14', async () => '1.50.0', async () => null, async () => { throw new Error('no dpkg') }]) {
      const t = setup(read)
      await t.service.checkInstalled()
      expect(t.service.current().installedVersion).toBeNull()
    }
  })

  it('Restart restarts; dismiss hides it until a newer version is installed', async () => {
    let installed: string | null = '1.60.39'
    const t = setup(async () => installed)
    await t.service.checkInstalled()
    t.service.dismiss()
    expect(t.service.current().installedVersion).toBeNull()
    await t.service.checkInstalled()
    expect(t.service.current().installedVersion).toBeNull()
    installed = '1.60.40'
    await t.service.checkInstalled()
    expect(t.service.current().installedVersion).toBe('1.60.40')
    t.service.install()
    expect(t.restarts).toHaveLength(1)
  })

  it('a window gaining focus looks again, at most once a minute', async () => {
    let reads = 0
    const t = setup(async () => { reads += 1; return null })
    await t.service.checkInstalled()
    t.service.windowFocused()
    expect(reads).toBe(1)
    await t.advance(INSTALLED_FOCUS_THROTTLE_MS)
    t.service.windowFocused()
    expect(reads).toBe(2)
  })
})

describe('reading the installed version', () => {
  const base: InstalledVersionInput = {
    platform: 'linux', packaged: true, appImagePath: undefined, execPath: '/opt/Apiary/apiary',
    exec: async () => '1.60.39\n', readFile: () => '',
  }

  it('asks dpkg on a .deb', async () => {
    expect(await readInstalledVersion(base)).toBe('1.60.39')
  })

  it('reads the bundle plist on a Mac', async () => {
    const plist = '<key>CFBundleShortVersionString</key>\n<string>1.60.39</string>'
    expect(plistVersion(plist)).toBe('1.60.39')
    const paths: string[] = []
    const got = await readInstalledVersion({
      ...base, platform: 'darwin', execPath: '/Applications/Apiary.app/Contents/MacOS/Apiary',
      readFile: (p) => { paths.push(p); return plist },
    })
    expect(got).toBe('1.60.39')
    expect(paths).toEqual(['/Applications/Apiary.app/Contents/Info.plist'])
  })

  it('never for an AppImage or a dev run', async () => {
    expect(await readInstalledVersion({ ...base, appImagePath: '/tmp/A.AppImage' })).toBeNull()
    expect(await readInstalledVersion({ ...base, packaged: false })).toBeNull()
  })
})
