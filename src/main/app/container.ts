import { join } from 'node:path'
import { AppService } from '../appService'
import { SettingsService } from '../settings/settingsService'
import { createSessionLayoutStore, type SessionLayoutStore } from '../windows/sessionLayoutStore'
import { createLayoutFlushCoordinator, type LayoutFlushCoordinator } from '../windows/layoutFlushCoordinator'
import { TabRegistry } from '../windows/tabRegistry'
import { WindowManager } from '../windows/windowManager'
import { ThemeStore, DEFAULT_THEME_ID } from '../theme/themeStore'
import { ThemeGenerator } from '../theme/themeGenerator'
import { createUpdater } from '../update/createUpdater'
import type { UpdateService } from '../update/updateService'
import { broadcast } from '../windows/broadcast'
import { CHANNELS } from '@shared/api'
import type { RuntimeEnv } from './env'

/**
 * The explicit composition root (MAIN-15 step 5): the one place that lists every long-lived
 * main-process object and what each is built from.
 *
 * Construction only. Nothing here opens a window, starts a timer, polls, refreshes, registers an
 * IPC handler or touches `electron`'s `app`: whatever needs Electron (paths, `isPackaged`, the
 * zsh shim written to disk, VS Code detection, the dock) is resolved by `index.ts` and passed in,
 * which is also what lets a unit test build the whole graph. (`SettingsService`'s constructor
 * does read and migrate `settings.json` — that is its documented contract, MAIN-16.)
 *
 * What stays outside, deliberately: `registerIpc` (it needs the dialog-backed `pickFolder` and the
 * auto-import timer from `index.ts`), starting the updater and status bar (after the first window),
 * and shutdown ordering (`index.ts`'s `shutdown`), none of which are construction.
 */
export interface ContainerPaths {
  configRoot: string
  dbPath: string
  settingsFile: string
  sessionLayoutFile: string
  themesFile: string
}

export interface ContainerInputs {
  /** Resolved by `index.ts` (`detectVsCode` or the test override); null when VS Code was not found. */
  vsCodePath: string | null
  /** `writeZshShim(...)`'s result — a file write, so done by the caller. */
  zshPromptShim: string
  /** The directory `index.ts` resolves its own files from, handed to `WindowManager`. */
  dirname: string
  /** `process.platform === 'darwin'`-style gate for reading the Keychain — never for a test fixture. */
  statusBarKeychain: boolean
  /** Read lazily by `WindowManager` (the quit-deferral is installed after the container exists). */
  isQuitting: () => boolean
}

export interface Container {
  paths: ContainerPaths
  settingsService: SettingsService
  sessionLayoutStore: SessionLayoutStore
  layoutFlushCoordinator: LayoutFlushCoordinator
  tabRegistry: TabRegistry
  windowManager: WindowManager
  service: AppService
  updater: UpdateService | null
  themeStore: ThemeStore
  themeGenerator: ThemeGenerator
}

export function createContainer(env: RuntimeEnv, paths: ContainerPaths, inputs: ContainerInputs): Container {
  const sessionLayoutStore = createSessionLayoutStore(paths.sessionLayoutFile)
  const layoutFlushCoordinator = createLayoutFlushCoordinator()
  const tabRegistry = new TabRegistry()
  // Reads the file once, migrates it and writes the migration back — see `SettingsService`'s own
  // doc comment (MAIN-16). Every later read/write in this process goes through this one instance.
  const settingsService = new SettingsService(paths.settingsFile)
  const windowManager = new WindowManager({
    settingsService,
    sessionLayoutStore,
    tabRegistry,
    headless: env.headless,
    dirname: inputs.dirname,
    rendererUrl: env.rendererUrl,
    isQuitting: inputs.isQuitting,
    ...(env.windowChrome !== undefined ? { chromeOverride: env.windowChrome } : {}),
  })
  const settings = settingsService.get()
  const fakeLive = env.fakeLive
  const service = new AppService({
    configRoot: paths.configRoot,
    dbPath: paths.dbPath,
    claudeBin: settings.claudeBin ?? undefined,
    autoImportAll: settings.autoImportAll,
    searchChatContent: settings.searchChatContent,
    searchSessionNotes: settings.searchSessionNotes,
    promptPath: {
      enabled: settings.terminalShortenPath,
      segments: settings.terminalPathSegments,
      minimal: settings.terminalMinimalPrompt,
    },
    zshPromptShim: inputs.zshPromptShim,
    plugins: settings.plugins,
    pluginSettings: settings.pluginSettings,
    // Test-only, like APIARY_FAKE_LIVE: points the merge-request plugin at a stand-in `glab`.
    glabPath: env.glabPath === '' ? undefined : env.glabPath,
    vsCodePath: inputs.vsCodePath,
    onPluginsChanged: () => { broadcast(CHANNELS.pluginsChanged) },
    onStatusBarChanged: () => { broadcast(CHANNELS.statusBarChanged) },
    statusBarKeychain: inputs.statusBarKeychain,
    onIndexUpdated: () => { broadcast(CHANNELS.treeChanged) },
    detectLive: fakeLive !== undefined && fakeLive !== ''
      ? async () => new Map([[fakeLive, 4242]])
      : undefined,
  })
  const updater = createUpdater(settingsService, env)
  const themeGenerator = new ThemeGenerator({ claudeBin: () => service.claudeBin })
  // APIARY_DEFAULT_THEME=original is test-only: the E2E suite is written against the original
  // look, so a fresh profile there starts on it rather than on the default theme.
  const themeStore = new ThemeStore(paths.themesFile, env.defaultThemeOriginal ? null : DEFAULT_THEME_ID)
  return {
    paths, settingsService, sessionLayoutStore, layoutFlushCoordinator, tabRegistry,
    windowManager, service, updater, themeStore, themeGenerator,
  }
}

/** The on-disk locations that sit beside `userData`, in one place. */
export function containerPaths(
  env: RuntimeEnv, userData: string, defaultConfigRoot: () => string,
): ContainerPaths {
  return {
    configRoot: env.configRoot ?? defaultConfigRoot(),
    dbPath: env.dbPath ?? join(userData, 'apiary.db'),
    settingsFile: join(userData, 'settings.json'),
    sessionLayoutFile: join(userData, 'session-layout.json'),
    themesFile: join(userData, 'themes.json'),
  }
}
