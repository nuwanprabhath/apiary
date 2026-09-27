import { CHANNELS } from '@shared/api'
import type { AppService } from '../appService'
import type { UpdateService } from '../update/updateService'
import type { SessionLayoutStore } from '../windows/sessionLayoutStore'
import type { LayoutFlushCoordinator } from '../windows/layoutFlushCoordinator'
import type { TabRegistry } from '../windows/tabRegistry'
import type { TabTransfer } from '@shared/types'
import type { TrustedRendererConfig } from './ipcSenderGuard'
import type { SettingsService } from '../settings/settingsService'
import { ClaudeProjectsSource, type SessionSource } from '../sources/claudeProjects'
import { broadcast } from '../windows/broadcast'
import { fireAndForget } from '../log/fireAndForget'
import { registerAll, type Handlers, type Listeners } from './registrar'
import { sessionsHandlers } from './handlers/sessions'
import { terminalsHandlers } from './handlers/terminals'
import { gitHandlers } from './handlers/git'
import { settingsHandlers } from './handlers/settings'
import { tabsHandlers } from './handlers/tabs'
import { pluginsHandlers } from './handlers/plugins'
import { updateHandlers } from './handlers/update'
import { logHandlers } from './handlers/log'
import { themeHandlers, type ThemeDeps } from './handlers/theme'

/**
 * Everything `registerIpc` needs, replacing the 11 positional parameters (up to 8 of them
 * optional, one — `getWindow` — unused) `ipc.ts`'s `registerIpc` used to take (MAIN-13 step 1).
 */
export interface IpcDeps {
  service: AppService
  configRoot: string
  /** Where sessions come from (MAIN-18). Defaults to `ClaudeProjectsSource`; injectable for
   *  tests, and shared with `AppService`'s own default when neither is given one explicitly. */
  source?: SessionSource
  /** The single owner of `settings.json` (MAIN-16) — see `settings/settingsService.ts`. */
  settings: SettingsService
  onAutoImportIntervalChange?: (intervalMinutes: number | null) => void
  /** Null where there is no updater at all (a dev run, or a platform without one). */
  updater?: UpdateService | null
  /** Null where the store has not been constructed yet (mirrors `updater` above). */
  sessionLayoutStore?: SessionLayoutStore | null
  /** Told about every incoming `reportLayout` so `before-quit` can wait for a specific window's. */
  layoutFlushCoordinator?: LayoutFlushCoordinator | null
  /** Opens a tab in a window of its own, resolving the new window's number. Injected so this
   *  module never imports the window code. */
  openDetachedWindow?: (tab: TabTransfer, at: { x: number; y: number }) => number
  /** Where every window's open tabs are recorded, for the Active section. Null where the registry
   *  has not been constructed yet, mirroring `sessionLayoutStore` above. */
  tabRegistry?: TabRegistry | null
  /** Maps the sending window's `webContents.id` to the window number `reportTabs` should file
   *  under, so `TabRegistry` (keyed by window number, same as `SessionLayoutStore`) never has to
   *  know about webContents ids at all. Populated in `main/index.ts`, next to where a window's
   *  number is minted. */
  windowNumberFor?: (webContentsId: number) => number | null
  /** Where the app's own renderer is expected to be loaded from (SEC-8 step 8) — null when not
   *  configured, which does not enforce anything. */
  trustedRenderer?: TrustedRendererConfig | null
  /** The theme store, safe-mode flag and generator — constructed in `main/index.ts` before
   *  windows exist, since a window reads its theme synchronously as it loads. */
  theme: ThemeDeps
}

/**
 * The composition root for every IPC channel, main's half of MAIN-11: each domain's handlers live
 * in `ipc/handlers/*.ts`, a thin adapter over `AppService` and the other collaborators — parse,
 * call a service, map the DTO, broadcast if the mutation means the UI is now stale. This function
 * only builds them, merges their `Pick<Handlers, …>` slices into one object satisfying the full
 * `Handlers` type (so a channel with no handler anywhere is a compile error, not a "No handler
 * registered" at runtime), and hands that to the registrar — which is also where the theme
 * channels join the same logging/sender-check/argument-guard wrapper as everything else
 * (MAIN-19 item 4; `themeIpc.ts` used to call `ipcMain.handle`/`.on` directly and skip it).
 */
export function registerIpc(deps: IpcDeps): { dispose: () => void; resetTheme: (route: string) => void } {
  const { service, configRoot } = deps

  const terminals = terminalsHandlers({ service, configRoot })
  const sessions = sessionsHandlers({ service, renameDeps: terminals.renameDeps })
  const git = gitHandlers({ service })
  const settingsIpc = settingsHandlers(deps)
  const tabs = tabsHandlers(deps)
  const plugins = pluginsHandlers({ service })
  const update = updateHandlers(deps)
  const logIpc = logHandlers()
  const theme = themeHandlers(deps.theme)

  const handlers: Handlers = {
    ...sessions,
    ...terminals.handlers,
    ...git,
    ...settingsIpc,
    ...tabs.handlers,
    ...plugins,
    ...update,
    ...logIpc.handlers,
    ...theme.handlers,
  }
  const listeners: Listeners = {
    ...terminals.listeners,
    ...tabs.listeners,
    ...logIpc.listeners,
    ...theme.listeners,
  }

  const disposeRegistry = registerAll(handlers, listeners, deps.trustedRenderer ?? null)

  // New session files appear without a restart, debounced into scoped refresh requests (MAIN-1) —
  // see `SessionWatcher` (MAIN-13 step 2) for the depth/ignore rationale (MAIN-25).
  const source = deps.source ?? new ClaudeProjectsSource(configRoot)
  const stopWatching = source.watch((paths) => {
    fireAndForget(service.refresh({ paths }).then(() => broadcast(CHANNELS.treeChanged)), 'watcher')
  })

  return {
    dispose: () => {
      stopWatching()
      disposeRegistry()
      terminals.dispose()
      tabs.dispose()
      theme.dispose()
    },
    resetTheme: theme.reset,
  }
}
