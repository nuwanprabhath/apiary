/**
 * An in-memory stand-in for `window.apiary`, the renderer's only way to reach the main process.
 *
 * Typed as `ApiaryApi` on purpose: a new IPC call that this fake does not implement is a type
 * error here, not a silent `undefined` in some component test that happens not to exercise it.
 *
 * It models the same four sessions the end-to-end harness writes to disk (tests/e2e/helpers.ts), so
 * a test moved down from end-to-end keeps its titles and its assertions. It is stateful where a
 * test needs a round trip — importing, renaming, notes, settings, git refs, themes — and records
 * every call, so a test can assert on what the renderer asked for instead of on what a real main
 * process would have done with it. What only the real app can prove (processes, persistence
 * across a relaunch, several windows) stays in tests/e2e.
 */
import type {
  ActiveTabPayload, ApiaryApi, AppSettingsPayload, DiscoveredSession, LogStatusPayload,
  PluginBarItemPayload, PluginInfoPayload, SavedTheme, ThemeOptions, ThemeState, UpdateStatusPayload,
} from '@shared/api'
import type {
  GitRefEntry, GitRefs, GitStatus, NewSessionInfo, ProjectNode, SessionNode, TranscriptMessage,
  TranscriptPage,
} from '@shared/types'
import { BUILTIN_THEMES } from '@shared/theme/builtins'

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
}

export interface FakeOptions {
  projects?: FakeProject[]
  sessions?: FakeSession[]
  /** Which sessions start imported: all of them (the default, like the e2e specs after `importAll`), or none. */
  imported?: 'all' | 'none'
  settings?: Partial<AppSettingsPayload>
  update?: Partial<UpdateStatusPayload>
  plugins?: PluginInfoPayload[]
  pluginBar?: PluginBarItemPayload[]
  refs?: Partial<GitRefs>
  vsCode?: boolean
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

export type FakeEvent =
  | 'activeTabsChanged' | 'selectTab' | 'themeChanged' | 'tabAdopt' | 'tabClaimed'
  | 'requestLayoutFlush' | 'newSessionStarted' | 'ptySessionsChanged' | 'mrStatusesInvalidated'
  | 'ptyData' | 'ptyExit' | 'treeChanged' | 'openImportDialog' | 'openSettingsDialog'
  | 'toggleSidebar' | 'pluginsChanged' | 'updateChanged'

export interface FakeState {
  projects: FakeProject[]
  sessions: FakeSession[]
  imported: Set<string>
  settings: AppSettingsPayload
  theme: ThemeState
  refs: GitRefs
  update: UpdateStatusPayload
  plugins: PluginInfoPayload[]
  pluginBar: PluginBarItemPayload[]
  tabs: ActiveTabPayload[]
  log: LogStatusPayload
  vsCode: boolean
}

const DAY = 24 * 60 * 60 * 1000

/** The e2e harness's layout: two plain folders, and a repository with one worktree under it. */
export const FIXTURE_PROJECTS: FakeProject[] = [
  { path: '/fixture/repo-c', label: 'repo-c', branch: 'main' },
  { path: '/fixture/repo-c-wt', label: 'repo-c-wt', branch: 'feature/wt', isWorktree: true, parent: '/fixture/repo-c' },
  { path: '/fixture/work-a', label: 'work-a', branch: null },
  { path: '/fixture/work-b', label: 'work-b', branch: null },
]

export const FIXTURE_SESSIONS: FakeSession[] = [
  {
    sessionId: '11111111-1111-1111-1111-111111111111',
    title: 'Fix CSV export bug',
    projectPath: '/fixture/work-a',
    gitBranch: 'main',
    messages: [
      message('u1', 'user', 'the export is empty'),
      message('side1', 'assistant', 'subagent side note', { isSidechain: true }),
      message('a1', 'assistant', 'done'),
    ],
  },
  { sessionId: '22222222-2222-2222-2222-222222222222', title: 'Add worktree switcher', projectPath: '/fixture/work-b', gitBranch: 'main' },
  { sessionId: '33333333-3333-3333-3333-333333333333', title: 'Repo root session', projectPath: '/fixture/repo-c', gitBranch: 'main' },
  { sessionId: '44444444-4444-4444-4444-444444444444', title: 'Worktree session', projectPath: '/fixture/repo-c-wt', gitBranch: 'feature/wt' },
]

export function message(
  uuid: string, role: 'user' | 'assistant', text: string, extra: Partial<TranscriptMessage> = {},
): TranscriptMessage {
  return { uuid, role, timestampMs: Date.parse('2026-09-01T10:00:00Z'), isSidechain: false, blocks: [{ type: 'text', text }], ...extra }
}

const ref = (name: string): GitRefEntry => ({ name, relativeDate: '2 days ago', author: 'Test', shortSha: 'abc1234', subject: `tip of ${name}` })

export const DEFAULT_SETTINGS: AppSettingsPayload = {
  claudeBin: null,
  autoImportAll: false,
  autoImportIntervalMinutes: null,
  revealActiveInSidebar: true,
  searchChatContent: true,
  searchSessionNotes: true,
  recentSectionEnabled: true,
  recentSectionHours: 24,
  terminalShortenPath: true,
  terminalPathSegments: 1,
  terminalMinimalPrompt: true,
  plugins: {},
  pluginSettings: {},
  updateAutomaticChecks: true,
  updateCheckIntervalHours: 6,
  updateAutoDownload: false,
  updateAllowPrerelease: false,
  diagnosticsEnabled: false,
  logRetentionDays: 7,
  logMaxSizeMb: 20,
}

const DEFAULT_UPDATE: UpdateStatusPayload = {
  phase: 'idle',
  capability: { kind: 'assisted', reason: 'This build is not signed, so macOS will not let it replace itself.' },
  currentVersion: '1.24.1',
  availableVersion: null,
  releaseNotes: null,
  releaseUrl: null,
  progressPercent: null,
  downloadedPath: null,
  install: null,
  openResult: null,
  error: null,
  lastCheckedAt: null,
  skippedVersion: null,
}

const THEME_OPTIONS: ThemeOptions = { animated: true, intensity: 1, model: 'sonnet' }

export function createFakeApiary(opts: FakeOptions = {}): FakeApiary {
  const sessions = (opts.sessions ?? FIXTURE_SESSIONS).map((s) => ({ ...s }))
  const state: FakeState = {
    projects: opts.projects ?? FIXTURE_PROJECTS,
    sessions,
    imported: new Set(opts.imported === 'none' ? [] : sessions.map((s) => s.sessionId)),
    settings: { ...DEFAULT_SETTINGS, ...opts.settings },
    theme: {
      activeId: null, active: null, saved: [], builtins: [...BUILTIN_THEMES], options: { ...THEME_OPTIONS }, safeMode: false,
    },
    refs: {
      current: 'main',
      local: [ref('main'), ref('feature/wt')],
      remote: [],
      tags: [ref('v1.0.0')],
      ...opts.refs,
    },
    update: { ...DEFAULT_UPDATE, ...opts.update },
    plugins: opts.plugins ?? [],
    pluginBar: opts.pluginBar ?? [],
    tabs: [],
    log: { enabled: false, dir: '/fixture/logs', files: 0, bytes: 0 },
    vsCode: opts.vsCode ?? false,
  }

  const calls: FakeCall[] = []
  const listeners = new Map<FakeEvent, Set<(...args: unknown[]) => void>>()
  const overrides = new Map<string, (...args: never[]) => unknown>()
  const on = (event: FakeEvent) => (cb: (...args: never[]) => void): (() => void) => {
    const set = listeners.get(event) ?? new Set()
    listeners.set(event, set)
    const fn = cb as (...args: unknown[]) => void
    set.add(fn)
    return () => { set.delete(fn) }
  }
  const emit = (event: FakeEvent, ...args: unknown[]): void => {
    for (const cb of [...(listeners.get(event) ?? [])]) cb(...args)
  }

  const sessionNode = (s: FakeSession): SessionNode => ({
    kind: 'session',
    sessionId: s.sessionId,
    title: s.title,
    cwd: s.projectPath,
    gitBranch: s.gitBranch ?? null,
    lastActiveAtMs: s.lastActiveAtMs ?? Date.now() - 22 * DAY,
    messageCount: (s.messages ?? []).length || 2,
    isLive: s.isLive ?? false,
    cwdExists: s.cwdExists ?? true,
    note: s.note ?? null,
  })
  const tree = (): ProjectNode[] => {
    const shown = state.sessions.filter((s) => state.imported.has(s.sessionId))
    const node = (p: FakeProject): ProjectNode => ({
      kind: 'project',
      path: p.path,
      label: p.label,
      branch: p.branch,
      isWorktree: p.isWorktree ?? false,
      children: state.projects.filter((c) => c.parent === p.path).map(node).filter((c) => hasSessions(c)),
      sessions: shown.filter((s) => s.projectPath === p.path).map(sessionNode),
    })
    const hasSessions = (n: ProjectNode): boolean => n.sessions.length > 0 || n.children.some(hasSessions)
    return state.projects.filter((p) => p.parent === undefined).map(node).filter(hasSessions)
  }
  const find = (id: string): FakeSession | undefined => state.sessions.find((s) => s.sessionId === id)
  const transcript = (id: string, beforeIndex?: number): TranscriptPage => {
    const s = find(id)
    const all = s?.messages ?? [message(`${id}-u`, 'user', 'fix the export'), message(`${id}-a`, 'assistant', 'done')]
    const end = beforeIndex ?? all.length
    const start = Math.max(0, end - 50)
    return { messages: all.slice(start, end), earlierCursor: start > 0 ? start : null, skippedLines: 0 }
  }
  let nextPty = 0
  const newSession = (cwd: string): NewSessionInfo => {
    nextPty += 1
    return { ptyId: `new:fake-${String(nextPty)}`, cwd, label: `New session · ${cwd.split('/').pop() ?? cwd}` }
  }

  const impl: ApiaryApi = {
    refresh: async () => { emit('treeChanged') },
    tree: async () => tree(),
    searchContent: async (q) => state.sessions
      .filter((s) => (s.messages ?? []).some((m) => m.blocks.some((b) => 'text' in b && b.text.toLowerCase().includes(q.toLowerCase()))))
      .map((s) => s.sessionId),
    discovered: async (): Promise<DiscoveredSession[]> => state.sessions.map((s) => ({
      sessionId: s.sessionId, projectPath: s.projectPath, title: s.title,
      lastActiveAtMs: s.lastActiveAtMs ?? Date.now() - 22 * DAY, imported: state.imported.has(s.sessionId),
    })),
    importSessions: async (ids) => { for (const id of ids) state.imported.add(id) },
    transcript: async (id, before) => transcript(id, before),
    checkConflict: async () => null,
    resume: async () => {},
    reportLayout: async () => {},
    reportTabs: (tabs) => {
      state.tabs = tabs.map((t) => ({ windowNumber: 1, key: t.key, view: t.view, status: 'stopped', label: t.label }))
      emit('activeTabsChanged')
    },
    activeTabs: async () => state.tabs,
    onActiveTabsChanged: on('activeTabsChanged'),
    focusTab: async () => {},
    onSelectTab: on('selectTab'),
    // As in main (ipc.ts), a change to what the tree shows is followed by a tree-changed event.
    renameSession: async (id, title) => { const s = find(id); if (s !== undefined) s.title = title; emit('treeChanged') },
    get initialTheme() { return state.theme },
    themeState: async () => state.theme,
    themeGpuCompositing: async () => true,
    themeApply: async (id) => {
      const spec = id === null ? null : (state.theme.builtins.find((b) => b.id === id)?.spec ?? state.theme.saved.find((t) => t.id === id)?.spec ?? null)
      state.theme = { ...state.theme, activeId: id, active: spec }
      emit('themeChanged', state.theme)
    },
    themeSave: async (name, spec, prompt) => {
      const saved: SavedTheme = { id: `saved:${String(state.theme.saved.length + 1)}`, name, prompt: prompt ?? null, createdAt: Date.now(), spec: spec as SavedTheme['spec'] }
      state.theme = { ...state.theme, saved: [...state.theme.saved, saved] }
      emit('themeChanged', state.theme)
      return saved
    },
    themeGenerate: async () => { throw new Error('No theme generator in component tests') },
    themeGenerateCancel: () => {},
    themeRename: async (id, name) => {
      state.theme = { ...state.theme, saved: state.theme.saved.map((t) => (t.id === id ? { ...t, name } : t)) }
      emit('themeChanged', state.theme)
    },
    themeDelete: async (id) => {
      state.theme = { ...state.theme, saved: state.theme.saved.filter((t) => t.id !== id), activeId: state.theme.activeId === id ? null : state.theme.activeId }
      emit('themeChanged', state.theme)
    },
    themeSetOptions: async (o) => { state.theme = { ...state.theme, options: { ...state.theme.options, ...o } }; emit('themeChanged', state.theme) },
    onThemeChanged: on('themeChanged'),
    renameTerminalInClaude: () => {},
    removeSession: async (id) => { state.imported.delete(id); emit('treeChanged') },
    moveSession: async (id, target) => { const s = find(id); if (s !== undefined) s.projectPath = target; emit('treeChanged') },
    openShell: async () => {},
    openShellForPty: async () => {},
    newSessionInProject: async (path) => newSession(path),
    forkSession: async (id) => ({ ...newSession(find(id)?.projectPath ?? '/fixture'), label: `fork: ${find(id)?.title ?? id}` }),
    logStatus: async () => state.log,
    logReveal: async () => state.log.dir,
    logClear: async () => { state.log = { ...state.log, files: 0, bytes: 0 }; return state.log },
    logWrite: () => {},
    tabDropped: async () => {},
    tabDetach: async () => {},
    tabAdoptHere: async () => {},
    onTabAdopt: on('tabAdopt'),
    onTabClaimed: on('tabClaimed'),
    onRequestLayoutFlush: on('requestLayoutFlush'),
    onNewSessionStarted: on('newSessionStarted'),
    ptyWrite: () => {},
    ptyResize: () => {},
    ptyKill: () => {},
    ptySnapshot: async () => null,
    ptySessions: async () => ({}),
    onPtySessionsChanged: on('ptySessionsChanged'),
    onMrStatusesInvalidated: on('mrStatusesInvalidated'),
    ptyRunning: async () => [],
    onPtyData: on('ptyData'),
    onPtyExit: on('ptyExit'),
    onTreeChanged: on('treeChanged'),
    onOpenImportDialog: on('openImportDialog'),
    settingsGet: async () => state.settings,
    settingsSet: async (s) => { state.settings = { ...state.settings, ...s } },
    onOpenSettingsDialog: on('openSettingsDialog'),
    onToggleSidebar: on('toggleSidebar'),
    gitStatus: async (): Promise<GitStatus> => ({ branch: state.refs.current, ahead: 0, behind: 0, hasUpstream: false }),
    gitListRefs: async () => state.refs,
    gitlabMrRefStatus: async () => ({}),
    gitCheckoutBranch: async (_k, _p, name) => { state.refs = { ...state.refs, current: name }; emit('treeChanged'); return { ok: true } },
    gitPullWorktree: async () => { emit('treeChanged'); return { path: '/fixture/repo-c-wt', commits: 0 } },
    newSessionInWorktree: async () => newSession('/fixture/repo-c-wt'),
    gitCheckoutRemote: async (_k, _p, _r, local) => {
      state.refs = { ...state.refs, current: local, local: [...state.refs.local, ref(local)] }
    },
    gitCheckoutDetached: async (_k, _p, r) => { state.refs = { ...state.refs, current: `(detached at ${r})` }; emit('treeChanged') },
    gitCreateBranch: async (_k, _p, name) => {
      state.refs = { ...state.refs, current: name, local: [...state.refs.local, ref(name)] }
    },
    gitPull: async () => ({ commits: 0 }),
    gitUpdateBranch: async () => ({ commits: 0 }),
    gitPullFolder: async () => { emit('treeChanged'); return { commits: 0 } },
    gitPush: async () => ({ commits: 0, published: false }),
    gitMerge: async () => { emit('treeChanged') },
    gitFetch: async () => { emit('treeChanged') },
    vsCodeAvailable: async () => state.vsCode,
    openInVsCode: async () => {},
    copyToClipboard: async () => {},
    searchRebuild: async () => {},
    searchStatus: async () => ({ indexed: state.sessions.length, notes: state.sessions.filter((s) => (s.note ?? '') !== '').length }),
    pluginBarItems: async () => state.pluginBar,
    pluginBarRefresh: async () => state.pluginBar,
    pluginRunAction: async () => {},
    pluginList: async () => state.plugins,
    onPluginsChanged: on('pluginsChanged'),
    setSessionNote: async (id, note) => { const s = find(id); if (s !== undefined) s.note = note === '' ? null : note; emit('treeChanged') },
    sessionNote: async (id) => find(id)?.note ?? '',
    saveImage: async () => '/fixture/images/pasted.png',
    readImage: async () => null,
    sendPrompt: async () => {},
    updateStatus: async () => state.update,
    updateCheck: async () => state.update,
    updateDownload: async () => state.update,
    updateInstall: async () => {},
    updateOpenDownloaded: async () => ({ ok: 'opened' }),
    // The same transitions as UpdateService.skip()/dismiss() in main.
    updateSkip: async () => {
      const version = state.update.availableVersion
      if (version === null) return
      state.update = { ...state.update, phase: 'idle', availableVersion: null, skippedVersion: version }
      emit('updateChanged', state.update)
    },
    updateDismiss: async () => {
      if (['available', 'up-to-date', 'error'].includes(state.update.phase)) {
        state.update = { ...state.update, phase: 'idle', error: null }
        emit('updateChanged', state.update)
      }
    },
    onUpdateChanged: on('updateChanged'),
  }

  // Every method goes through here, so calls are recorded and a test can swap one out. The theme
  // snapshot is a getter on `impl`, read through rather than copied, so it stays live.
  const fake = { calls, state, emit } as unknown as FakeApiary
  for (const name of Object.keys(impl) as (keyof ApiaryApi)[]) {
    if (name === 'initialTheme') {
      Object.defineProperty(fake, name, { get: () => state.theme, enumerable: true })
      continue
    }
    // eslint-disable-next-line @typescript-eslint/unbound-method -- every member of `impl` is an arrow function, so there is no `this` to lose
    const original = impl[name] as (...args: unknown[]) => unknown
    Object.defineProperty(fake, name, {
      enumerable: true,
      value: (...args: unknown[]) => {
        calls.push({ name, args })
        const swapped = overrides.get(name)
        return swapped !== undefined ? (swapped as (...a: unknown[]) => unknown)(...args) : original(...args)
      },
    })
  }
  fake.callsTo = (name) => calls.filter((c) => c.name === name).map((c) => c.args)
  fake.override = (name, fn) => { overrides.set(name, fn as (...args: never[]) => unknown) }
  return fake
}
