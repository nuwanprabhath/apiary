import type { WebContents } from 'electron'
import type { AppService } from '../appService'
import type { ChatService } from '../chat/chatService'
import type { PluginService } from '../plugins/pluginService'
import type { IpcState } from './ipcState'
import type { UpdateService } from '../update/updateService'
import type { SessionLayoutStore } from '../windows/sessionLayoutStore'
import type { LayoutFlushCoordinator } from '../windows/layoutFlushCoordinator'
import type { TabRegistry } from '../windows/tabRegistry'
import type { ActiveTabsService } from '../terminals/activeTabsService'
import type { SenderPolicy } from './ipcSenderGuard'
import type { SettingsService } from '../settings/settingsService'
import { createDispatcher, registerAll, type CallRouter, type Dispatcher, type Handlers, type Listeners } from './registrar'
import { sessionsHandlers } from './handlers/sessions'
import { terminalsHandlers } from './handlers/terminals'
import { gitHandlers } from './handlers/git'
import { settingsHandlers } from './handlers/settings'
import { tabsHandlers } from './handlers/tabs'
import { pluginsHandlers } from './handlers/plugins'
import { chatHandlers } from './handlers/chat'
import { updateHandlers } from './handlers/update'
import { logHandlers } from './handlers/log'
import { appChromeHandlers } from './handlers/appChrome'
import { themeHandlers, type ThemeDeps } from './handlers/theme'
import { petsHandlers, type PetDeps } from './handlers/pets'
import { spellingHandlers } from './handlers/spelling'
import { contextMenuHandlers } from './handlers/contextMenu'
import type { RemoteClientService } from '../remote/remoteClientService'
import { remoteConnectHandlers } from './handlers/remoteConnect'
import { foldersHandlers } from './handlers/folders'
import type { FolderBrowser } from '../folders/folderBrowser'
import { remoteHostsHandlers } from './handlers/remoteHosts'
import { remoteClientsHandlers } from './handlers/remoteClients'
import type { HostDirectory } from '../remote/hostDirectory'
import type { PairingStore } from '../remote/pairingStore'
import type { RemoteServer } from '../remote/remoteServer'
import type { SpellingService } from '../spelling/spellingService'

/**
 * Everything `registerIpc` needs, replacing the 11 positional parameters (up to 8 of them
 * optional, one — `getWindow` — unused) `ipc.ts`'s `registerIpc` used to take (MAIN-13 step 1).
 */
export interface IpcDeps {
  service: AppService
  /** Chat mode and the plugins have services of their own, which their handlers call directly. */
  chat: ChatService
  plugins: PluginService
  /** Built in the container; see `IpcState`. */
  state: IpcState
  /** The single owner of `settings.json` (MAIN-16) — see `settings/settingsService.ts`. */
  settings: SettingsService
  spelling: SpellingService
  /** The in-app folder browser a remote window uses instead of the native picker; built in the container. */
  folderBrowser: FolderBrowser
  onAutoImportIntervalChange?: (intervalMinutes: number | null) => void
  /** Null where there is no updater at all (a dev run, or a platform without one). */
  updater?: UpdateService | null
  /** Null where the store has not been constructed yet (mirrors `updater` above). */
  sessionLayoutStore?: SessionLayoutStore | null
  /** Told about every incoming `reportLayout` so `before-quit` can wait for a specific window's. */
  layoutFlushCoordinator?: LayoutFlushCoordinator | null
  /** Where every window's open tabs are recorded, for the Active section. Null where the registry
   *  has not been constructed yet, mirroring `sessionLayoutStore` above. */
  tabRegistry?: TabRegistry | null
  /** Maps the sending window's `webContents.id` to the window number `reportTabs` should file
   *  under, so `TabRegistry` (keyed by window number, same as `SessionLayoutStore`) never has to
   *  know about webContents ids at all. Populated in `main/index.ts`, next to where a window's
   *  number is minted. */
  windowNumberFor?: (webContentsId: number) => number | null
  /** Classifies each open tab for the Active section; built in the container with what it reads. */
  activeTabs: ActiveTabsService
  /** The native folder picker, over the asking window. Resolves null when cancelled. Injected so
   *  this module does not own the dialog (or its E2E stand-in, `APIARY_PICK_FOLDER`). */
  pickFolder?: (sender: WebContents) => Promise<string | null>
  /** Where the app's own renderer is expected to be loaded from (SEC-8 step 8). Required, so the
   *  check cannot be forgotten: a test harness that calls handlers without a frame passes
   *  `UNCHECKED_SENDERS` (see `ipcSenderGuard.ts`); anything else rejects a message with no frame. */
  senderPolicy: SenderPolicy
  /** The theme store, safe-mode flag and generator — constructed in `main/index.ts` before
   *  windows exist, since a window reads its theme synchronously as it loads. */
  theme: ThemeDeps
  /** The pet store and service, built in the container. */
  pets: PetDeps
  // The remote-access deps are required, `null` where the feature does not exist: index.ts once
  // left three of them out, and the connect dialog's host list and the work machine's clients,
  // Disconnect all and pairing code did nothing in the real app while every faked test passed.
  /** Routes a window showing a work machine's calls (`remote/remoteWindows.ts`); none where remote windows do not exist. */
  router: CallRouter | null
  /** The home side of remote access (`remote/remoteClientService.ts`); none where remote windows do not exist. */
  remoteClient: RemoteClientService | null
  /** Candidate hosts for a remote connection; none where remote windows do not exist. */
  hostDirectory: HostDirectory | null
  /** The work machine's end of remote access and its pairing code; none where remote access does not exist. */
  remoteServer: RemoteServer | null
  remotePairing: PairingStore | null
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
export function registerIpc(
  deps: IpcDeps,
): { dispose: () => void; resetTheme: (route: string) => void; dispatcher: Dispatcher } {
  const { service } = deps

  const terminals = terminalsHandlers({ service, state: deps.state })
  const sessions = sessionsHandlers({ service, renameDeps: terminals.renameDeps, pickFolder: deps.pickFolder })
  const git = gitHandlers({ service })
  const settingsIpc = settingsHandlers(deps)
  const tabs = tabsHandlers(deps)
  const plugins = pluginsHandlers({ plugins: deps.plugins })
  const chat = chatHandlers({ chat: deps.chat })
  const update = updateHandlers(deps)
  const logIpc = logHandlers()
  const theme = themeHandlers(deps.theme)
  const appChrome = appChromeHandlers()
  const pets = petsHandlers(deps.pets)
  const spelling = spellingHandlers(deps.spelling)
  const contextMenu = contextMenuHandlers()
  const remoteConnectIpc = remoteConnectHandlers({ remoteClient: deps.remoteClient ?? null })
  const folders = foldersHandlers({ service, folderBrowser: deps.folderBrowser })
  const remoteHostsIpc = remoteHostsHandlers({ hosts: deps.hostDirectory ?? null })
  const remoteClientsIpc = remoteClientsHandlers({ server: deps.remoteServer ?? null, pairing: deps.remotePairing ?? null })

  const handlers: Handlers = {
    ...sessions,
    ...terminals.handlers,
    ...git,
    ...settingsIpc,
    ...tabs.handlers,
    ...plugins,
    ...chat.handlers,
    ...update,
    ...logIpc.handlers,
    ...theme.handlers,
    ...appChrome.handlers,
    ...pets.handlers,
    ...spelling,
    ...remoteConnectIpc,
    ...folders.handlers,
    ...remoteHostsIpc,
    ...remoteClientsIpc,
  }
  const listeners: Listeners = {
    ...terminals.listeners,
    ...chat.listeners,
    ...tabs.listeners,
    ...logIpc.listeners,
    ...theme.listeners,
    ...appChrome.listeners,
    ...pets.listeners,
    ...contextMenu.listeners,
    ...folders.listeners,
  }

  // Local windows reach it through `registerAll`'s sender check; the remote server calls it directly.
  const dispatcher = createDispatcher(handlers, listeners)
  const disposeRegistry = registerAll(handlers, listeners, deps.senderPolicy, dispatcher, deps.router ?? null)

  return {
    dispose: () => {
      disposeRegistry()
      terminals.dispose()
      tabs.dispose()
      theme.dispose()
    },
    resetTheme: theme.reset,
    dispatcher,
  }
}
