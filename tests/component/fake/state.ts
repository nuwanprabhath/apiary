/**
 * The fake bridge's types: what it is built from (`FakeOptions`), the mutable state behind it
 * (`FakeState`), and the small `Env` every area of the fake is handed. See `../fakeApiary.ts`.
 */
import type { StatusBarItem, StatusBarPanel } from '@shared/domain/statusBar'
import type {
  ActiveTabPayload, ApiaryApi, AppSettingsPayload, LogStatusPayload, PluginBarItemPayload, PluginInfoPayload, ThemeState,
  UpdateStatusPayload,
} from '@shared/api'
import type { GitTarget } from '@shared/domain/git'
import type { RemoteClientInfo, RemoteHost } from '@shared/domain/remote'
import type { ChatState, TerminalBusy } from '@shared/domain/chat'
import type { EventKey } from '@shared/ipc/contract'
import type { PetSpec } from '@shared/pets/spec'
import type { PetsState } from '@shared/pets/state'
import type { TerminalRef } from '@shared/domain/ids'
import type { FolderWorktree, GitRefs, NewSessionInfo, TranscriptMessage } from '@shared/types'

export interface FakeSession {
  sessionId: string
  title: string
  /** The project (folder) the session is filed under — one of `FakeProject.path`. */
  projectPath: string
  gitBranch?: string | null
  lastActiveAtMs?: number | null
  isLive?: boolean
  cwdExists?: boolean
  note?: string | null
  /** Oldest first. Defaults to a two-message exchange like the e2e fixture's. */
  messages?: TranscriptMessage[]
}

export interface FakeProject {
  path: string
  label: string
  branch: string | null
  isWorktree?: boolean
  /** The repository this one is a worktree of, when it is one. */
  parent?: string
  /** Not a git repository: every git call on it fails or answers nothing, as in main. */
  notRepo?: boolean
  /** Bookkeeping of the fake itself: it started with a branch to show, so the tree keeps showing one. */
  tracked?: boolean
  /** Bookkeeping of the fake itself: a ref is checked out rather than a branch. */
  detached?: boolean
}

export interface FakeOptions {
  projects?: FakeProject[]
  sessions?: FakeSession[]
  /** Which sessions start imported: all of them (the default, like the e2e specs after `importAll`), or none. */
  imported?: 'all' | 'none'
  settings?: Partial<AppSettingsPayload>
  update?: Partial<UpdateStatusPayload>
  /** The newest release the update feed offers; defaults to `update.availableVersion`, else none. */
  updateFeed?: string | null
  plugins?: PluginInfoPayload[]
  pluginBar?: PluginBarItemPayload[]
  refs?: Partial<GitRefs>
  /** Branches that track an upstream. Default: none. */
  upstream?: string[]
  vsCode?: boolean
  /** What `listWorktrees` answers, by folder path. A folder with no entry has the other worktrees of its repository. */
  worktrees?: Record<string, FolderWorktree[]>
  /** The status bar's items. Default: none (the real Claude usage plugin reads a network). */
  statusBar?: StatusBarItem[]
  /** The dashboard `statusBarPanel` answers for any item. */
  statusBarPanel?: StatusBarPanel | null
  /** The folder the native picker answers with; null when it is dismissed. Default `/fixture/picked`. */
  pickedFolder?: string | null
}

export interface FakeCall { name: string; args: unknown[] }

export type FakeApiary = ApiaryApi & {
  /** Every call the renderer made, in order. */
  calls: FakeCall[]
  /** The arguments of each call to `name`. */
  callsTo(name: keyof ApiaryApi): unknown[][]
  /** Fires one of the `on…` subscriptions, as the main process would. */
  emit(event: FakeEvent, ...args: unknown[]): void
  /** Replace what a method does, for one test (a rejection, a slow answer, a different result). */
  override<K extends keyof ApiaryApi>(name: K, impl: ApiaryApi[K]): void
  /** The mutable state behind the fake — sessions, settings, refs — for arranging a test. */
  state: FakeState
}

/** Every event of the contract, so a new one is emittable the moment it exists. */
export type FakeEvent = EventKey

/** How far a branch is from its upstream; `pending` is on the remote but not yet fetched. */
export interface Tracking { upstream: boolean; ahead: number; behind: number; pending: number }

export interface FakeState {
  /** Hosts `remoteConnect` was asked for, in order. */
  remoteConnects: string[]
  /** The pairing code each `remoteConnect` was given (undefined when none), in order. */
  remoteConnectPairings: (string | undefined)[]
  /** The home machines connected to this one (the work machine's view), and how often "Disconnect all" ran. */
  remoteClients: RemoteClientInfo[]
  remoteDisconnects: number
  /** This machine's pairing code as shown (`XXXX-XXXX`); `remotePairingNew` replaces it. */
  remotePairingCode: string
  /** When set, `remoteConnect` fails with this message (main's words for an ssh or Apiary refusal). */
  remoteConnectError: string | null
  /** Hosts `remoteStartAndConnect` was asked for, in order. */
  remoteStarts: string[]
  /** When set, `remoteStartAndConnect` fails with this message. */
  remoteStartError: string | null
  /** What `remoteHosts` lists (a test sets it, and emits `remoteHostsChanged` as probes would). */
  remoteHosts: RemoteHost[]
  /** The `probe` argument of each `remoteHosts` call, in order. */
  remoteHostProbes: boolean[]
  projects: FakeProject[]
  sessions: FakeSession[]
  imported: Set<string>
  /** Removed from the tree (main archives; the session stays discovered and imported). */
  archived: Set<string>
  settings: AppSettingsPayload
  theme: ThemeState
  refs: GitRefs
  /** Per branch name: whether it tracks an upstream, and how far ahead and behind it is. */
  tracking: Map<string, Tracking>
  update: UpdateStatusPayload
  /** The newest release the update feed offers, or none. */
  updateFeed: string | null
  plugins: PluginInfoPayload[]
  pluginBar: PluginBarItemPayload[]
  /** Every window's open tabs, this window's first. */
  tabs: ActiveTabPayload[]
  log: LogStatusPayload
  vsCode: boolean
  worktrees: Record<string, FolderWorktree[]>
  statusBar: StatusBarItem[]
  /** Chat mode, by session id: what `chatState` answers and the `chat*` calls change. */
  chats: Map<string, ChatState>
  /** Sessions whose chat this window has attached (`chatAttach`); `chatChanged` goes only to those. */
  chatAttached: Set<string>
  /** What `terminalBusy` answers, by session id; not busy when absent. */
  terminalBusy: Map<string, TerminalBusy>
  statusBarPanel: StatusBarPanel | null
  /** Pets: what `petsState` answers; the pet calls change it and emit `petsChanged`. */
  pets: PetsState
  /** What `petChat` answers. */
  petReply: string
  /** What `petClaudeActions` reports for each session key, and what `petComment` answers. */
  petActions: Record<string, string>
  petComment: string | null
  /** The pet in the file the user last exported to (and `petImport` reads); null before any export. */
  petFile: PetSpec | null
  /** The folder the native picker answers with; null when it is dismissed. */
  pickedFolder: string | null
  /** Names in the fake home that are links leading outside it (`fake/folders.ts`). */
  homeLinks: Set<string>
  /** Pasted images, by the path `saveImage` answered with. */
  images: Map<string, string>
  /** The web addresses the app asked the operating system to open, in order. */
  opened: string[]
  /** The text the app asked the clipboard to hold, in order. */
  copied: string[]
}

/** What each area of the fake is handed. */
export interface Env {
  state: FakeState
  emit: (event: FakeEvent, ...args: unknown[]) => void
  find: (id: string) => FakeSession | undefined
  /** Mints a pending terminal for a session started in `cwd`. */
  newSession: (cwd: string) => NewSessionInfo
  /** The pending terminals `newSession` has minted, and the folder each was started in. */
  pendingPtys: Map<string, string>
  /** The folder a git call acts on, when the app knows it. */
  projectOf: (target: GitTarget | TerminalRef) => FakeProject | undefined
}
