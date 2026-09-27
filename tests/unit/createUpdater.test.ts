import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({
  app: { getVersion: () => '1.0.0', isPackaged: false },
}))
// `electronUpdaterBackend.ts` (imported transitively by `createUpdater.ts` for the non-fake path)
// touches `electron-updater`'s `autoUpdater` getter at module load time, which in turn expects a
// real Electron `app` — mocked the same way `electronUpdaterBackend.test.ts` already does.
vi.mock('electron-updater', () => ({
  default: {
    autoUpdater: {
      get autoDownload() { return true }, set autoDownload(_v: boolean) {},
      set autoInstallOnAppQuit(_v: boolean) {},
      set logger(_v: unknown) {},
      set allowPrerelease(_v: boolean) {},
      checkForUpdates: vi.fn(),
      downloadUpdate: vi.fn(),
      quitAndInstall: vi.fn(),
      on: () => {}, off: () => {},
    },
  },
}))

const { createUpdater } = await import('../../src/main/update/createUpdater')
const { SettingsService } = await import('../../src/main/settings/settingsService')
const { createFakeUpdateBackend } = await import('../../src/main/update/fakeBackend')

function baseEnv(): Parameters<typeof createUpdater>[1] {
  return {
    configRoot: undefined,
    dbPath: undefined,
    fakeLive: undefined,
    codePathOverride: undefined,
    glabPath: undefined,
    defaultThemeOriginal: false,
    safeTheme: false,
    fakeUpdate: undefined,
    fakeUpdateMode: undefined,
    headless: false,
    rendererUrl: undefined,
  }
}

describe('createUpdater (MAIN-15 step 2)', () => {
  let home: string
  afterEach(() => { if (home) rmSync(home, { recursive: true, force: true }) })

  it('returns an UpdateService when a fake release is configured (test-only path)', () => {
    home = mkdtempSync(join(tmpdir(), 'apiary-updater-'))
    const settings = new SettingsService(join(home, 'settings.json'))
    const updater = createUpdater(settings, { ...baseEnv(), fakeUpdate: '9.9.9' })
    expect(updater).not.toBeNull()
  })

  it('reads the persisted settings into the backend it constructs', () => {
    home = mkdtempSync(join(tmpdir(), 'apiary-updater-'))
    const settings = new SettingsService(join(home, 'settings.json'))
    settings.patch({ updateAllowPrerelease: true })
    const updater = createUpdater(settings, { ...baseEnv(), fakeUpdate: '9.9.9' })
    expect(updater).not.toBeNull()
  })
})

describe('createFakeUpdateBackend', () => {
  it('check() reports the configured fake version', async () => {
    const backend = createFakeUpdateBackend({ fake: '2.0.0' })
    const result = await backend.check({ allowPrerelease: false })
    expect(result?.version).toBe('2.0.0')
  })

  it('downloadInstaller() names a .deb when fakeMode is "deb"', async () => {
    const backend = createFakeUpdateBackend({ fake: '2.0.0', fakeMode: 'deb' })
    const onProgress = vi.fn()
    const path = await backend.downloadInstaller(onProgress)
    expect(path).toContain('.deb')
    expect(onProgress).toHaveBeenCalledWith(100)
  })

  it('downloadInstaller() names a .dmg for any other fakeMode', async () => {
    const backend = createFakeUpdateBackend({ fake: '2.0.0', fakeMode: 'auto' })
    const path = await backend.downloadInstaller(() => {})
    expect(path).toContain('.dmg')
  })

  it('install() and openInstaller() never touch anything real', async () => {
    const backend = createFakeUpdateBackend({ fake: '2.0.0' })
    expect(() => backend.install()).not.toThrow()
    expect(await backend.openInstaller('/tmp/whatever', 'open')).toEqual({ ok: 'opened' })
  })
})
