import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({
  app: { getVersion: () => '1.0.0', isPackaged: false, getPath: () => tmpdir() },
  BrowserWindow: class {},
  screen: {},
  shell: {},
  ipcMain: {},
}))
vi.mock('electron-updater', () => ({
  default: {
    autoUpdater: {
      get autoDownload() { return true }, set autoDownload(_v: boolean) {},
      set autoInstallOnAppQuit(_v: boolean) {},
      set logger(_v: unknown) {},
      set allowPrerelease(_v: boolean) {},
      checkForUpdates: vi.fn(), downloadUpdate: vi.fn(), quitAndInstall: vi.fn(),
      on: () => {}, off: () => {},
    },
  },
}))

const { createContainer, containerPaths } = await import('../../src/main/app/container')
const { parseRuntimeEnv } = await import('../../src/main/app/env')

let dir: string | null = null
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = null
})

describe('containerPaths', () => {
  it('prefers the test overrides and otherwise puts every file beside userData', () => {
    const env = parseRuntimeEnv({ APIARY_CONFIG_ROOT: '/fixture/.claude' }, [], false)
    const p = containerPaths(env, '/u', () => '/real/.claude')
    expect(p).toEqual({
      configRoot: '/fixture/.claude',
      dbPath: '/u/apiary.db',
      settingsFile: '/u/settings.json',
      sessionLayoutFile: '/u/session-layout.json',
      themesFile: '/u/themes.json',
      petsFile: '/u/pets.json',
    })
    const real = containerPaths(parseRuntimeEnv({}, [], false), '/u', () => '/real/.claude')
    expect(real.configRoot).toBe('/real/.claude')
  })
})

describe('createContainer', () => {
  it('builds the whole graph without opening a window, a timer or a refresh', async () => {
    dir = mkdtempSync(join(tmpdir(), 'apiary-container-'))
    const env = parseRuntimeEnv({ APIARY_HEADLESS: '1' }, [], false)
    const paths = containerPaths(env, dir, () => join(dir!, '.claude'))
    const c = createContainer(env, paths, {
      vsCodePath: null, zshPromptShim: join(dir, 'zsh'), dirname: dir,
      statusBarKeychain: false, isQuitting: () => false,
    })
    try {
      expect(c.service.pty).toBeDefined()
      expect(c.windowManager.front()).toBeNull()
      expect(await c.service.tree()).toEqual([]) // nothing refreshed, nothing discovered
      expect(c.settingsService.get()).toBeDefined()
      expect(c.updater).toBeNull() // no fake update and not packaged-with-feed: nothing started
    } finally {
      await c.service.dispose()
    }
    expect(existsSync(paths.dbPath)).toBe(true)
  })
})
