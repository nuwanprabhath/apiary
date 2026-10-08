/**
 * An in-memory stand-in for `window.apiary`, the renderer's only way to reach the main process.
 *
 * Typed as `ApiaryApi` on purpose: a new IPC call that this fake does not implement is a type
 * error here, not a silent `undefined` in some component test that happens not to exercise it.
 *
 * It models the same four sessions the end-to-end harness writes to disk (tests/e2e/helpers.ts), so
 * a test moved down from end-to-end keeps its titles and its assertions. It is stateful where a
 * test needs a round trip — importing, renaming, notes, settings, git refs, themes, pets, chat —
 * and records every call, so a test can assert on what the renderer asked for instead of on what a
 * real main process would have done with it. What only the real app can prove (processes, persistence
 * across a relaunch, several windows) stays in tests/e2e.
 *
 * It is a model of main, and the model is checked: `tests/contract/bridgeContract.ts` runs one
 * behavioural spec against this fake and against the real preload and handlers, so a fake that
 * answers differently from main fails there. Each area lives in `fake/` and says which clause file
 * pins it. Two things hold for every call, by construction: its arguments pass the contract's own
 * guard (a malformed call is refused as main's registrar refuses it), and what crosses the bridge
 * (arguments, results, event payloads) is a copy, as it is over Electron's IPC, so a component cannot
 * lean on sharing an object with the fake's state.
 */
import type { ApiaryApi } from '@shared/api'
import { IPC } from '@shared/ipc/contract'
import { asPtyId } from '@shared/domain/ids'
import type { NewSessionInfo } from '@shared/types'
import { DEFAULT_SETTINGS_PAYLOAD } from '@shared/settingsDefaults'
import { STANDARD_SESSIONS as STD } from '../fixtures/standard'
import { chatApi } from './fake/chat'
import { fakeRef, gitApi } from './fake/git'
import { fakePet, petsApi } from './fake/pets'
import { message, sessionsApi } from './fake/sessions'
import { settingsApi } from './fake/settings'
import type { Env, FakeApiary, FakeCall, FakeEvent, FakeOptions, FakeProject, FakeSession, FakeState } from './fake/state'
import { initialThemeState, themesApi } from './fake/themes'
import { tabsApi } from './fake/tabs'
import { updateApi } from './fake/update'

export type { FakeApiary, FakeCall, FakeEvent, FakeOptions, FakeProject, FakeSession, FakeState }
export { fakePet, fakeRef, message }

/** The e2e harness's layout: two plain folders, and a repository with one worktree under it. */
export const FIXTURE_PROJECTS: FakeProject[] = [
  { path: '/fixture/repo-c', label: 'repo-c', branch: 'main' },
  { path: '/fixture/repo-c-wt', label: 'repo-c-wt', branch: 'feature/wt', isWorktree: true, parent: '/fixture/repo-c' },
  { path: '/fixture/work-a', label: 'work-a', branch: null },
  { path: '/fixture/work-b', label: 'work-b', branch: null },
]

export const FIXTURE_SESSIONS: FakeSession[] = [
  {
    sessionId: STD.csv.id,
    title: STD.csv.title,
    projectPath: '/fixture/work-a',
    gitBranch: 'main',
    messages: [
      message('u1', 'user', STD.csv.firstPrompt),
      message('side1', 'assistant', 'subagent side note', { isSidechain: true }),
      message('a1', 'assistant', 'done'),
    ],
  },
  { sessionId: STD.switcher.id, title: STD.switcher.title, projectPath: '/fixture/work-b', gitBranch: 'main' },
  { sessionId: STD.repoRoot.id, title: STD.repoRoot.title, projectPath: '/fixture/repo-c', gitBranch: 'main' },
  { sessionId: STD.worktree.id, title: STD.worktree.title, projectPath: '/fixture/repo-c-wt', gitBranch: 'feature/wt' },
]

// Shared with src/main/settings.ts (TEST-5): a hand-copy here was a checked-nowhere place for the
// fake's defaults to drift from what main actually ships.
export const DEFAULT_SETTINGS = DEFAULT_SETTINGS_PAYLOAD

const DEFAULT_UPDATE: FakeState['update'] = {
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

export function createFakeApiary(opts: FakeOptions = {}): FakeApiary {
  const sessions = (opts.sessions ?? FIXTURE_SESSIONS).map((s) => ({ ...s }))
  const projects = (opts.projects ?? FIXTURE_PROJECTS).map((p) => ({ ...p, tracked: p.branch !== null }))
  const update = { ...DEFAULT_UPDATE, ...opts.update }
  // A status-bar item or a bar button always comes from a plugin; one handed in without its plugin
  // gets a plain one, switched on.
  const plugins = [...(opts.plugins ?? [])]
  for (const id of new Set([...(opts.statusBar ?? []), ...(opts.pluginBar ?? [])].map((i) => i.pluginId))) {
    if (!plugins.some((p) => p.id === id)) plugins.push({ id, name: id, description: null, enabled: true, fields: [], values: {} })
  }
  const state: FakeState = {
    projects,
    sessions,
    imported: new Set(opts.imported === 'none' ? [] : sessions.map((s) => s.sessionId)),
    archived: new Set(),
    settings: { ...DEFAULT_SETTINGS, ...opts.settings },
    theme: initialThemeState(),
    refs: {
      current: 'main',
      local: [fakeRef('main'), fakeRef('feature/wt')],
      remote: [],
      tags: [fakeRef('v1.0.0')],
      ...opts.refs,
    },
    tracking: new Map((opts.upstream ?? []).map((branch) => [branch, { upstream: true, ahead: 0, behind: 0, pending: 0 }])),
    update,
    updateFeed: opts.updateFeed !== undefined ? opts.updateFeed : update.availableVersion,
    plugins,
    pluginBar: opts.pluginBar ?? [],
    tabs: [],
    log: { enabled: false, dir: '/fixture/logs', files: 0, bytes: 0 },
    vsCode: opts.vsCode ?? false,
    worktrees: opts.worktrees ?? {},
    statusBar: opts.statusBar ?? [],
    chats: new Map(),
    chatAttached: new Set(),
    terminalBusy: new Map(),
    statusBarPanel: opts.statusBarPanel ?? null,
    pets: { enabled: false, pets: [], generating: false },
    petReply: 'Hehe, hi!',
    petActions: {},
    petComment: null,
    petFile: null,
    pickedFolder: opts.pickedFolder !== undefined ? opts.pickedFolder : '/fixture/picked',
    images: new Map(),
    opened: [],
    copied: [],
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
  // What crosses the bridge is a copy, as over Electron's IPC: every listener gets its own, so a
  // component cannot lean on sharing an object with the fake's state (or with another window).
  const emit = (event: FakeEvent, ...args: unknown[]): void => {
    for (const cb of [...(listeners.get(event) ?? [])]) cb(...structuredClone(args))
  }

  const find = (id: string): FakeSession | undefined => state.sessions.find((s) => s.sessionId === id)
  const pendingPtys = new Map<string, string>()
  let nextPty = 0
  const newSession = (cwd: string): NewSessionInfo => {
    nextPty += 1
    const ptyId = asPtyId(`new:fake-${String(nextPty)}`)
    pendingPtys.set(ptyId, cwd)
    return { ptyId, cwd, label: cwd.split('/').pop() ?? cwd }
  }
  const projectOf: Env['projectOf'] = (target) => {
    if (target.kind === 'folder') return state.projects.find((p) => p.path === target.path)
    const path = target.kind === 'session' ? find(target.id)?.projectPath : pendingPtys.get(target.id)
    return state.projects.find((p) => p.path === path)
  }
  const env: Env = { state, emit, find, newSession, projectOf, pendingPtys }

  const impl: ApiaryApi = {
    ...sessionsApi(env),
    ...settingsApi(env),
    ...themesApi(env),
    ...petsApi(env),
    ...chatApi(env),
    ...updateApi(env),
    ...tabsApi(env),
    ...gitApi(env),
    get initialTheme() { return state.theme },
    onActiveTabsChanged: on('activeTabsChanged'),
    onSelectTab: on('selectTab'),
    onThemeChanged: on('themeChanged'),
    onPetsChanged: on('petsChanged'),
    onTabAdopt: on('tabAdopt'),
    onTabClaimed: on('tabClaimed'),
    onRequestLayoutFlush: on('requestLayoutFlush'),
    onNewSessionStarted: on('newSessionStarted'),
    onPtySessionsChanged: on('ptySessionsChanged'),
    onMrStatusesInvalidated: on('mrStatusesInvalidated'),
    onPtyData: on('ptyData'),
    onPtyExit: on('ptyExit'),
    onTreeChanged: on('treeChanged'),
    onOpenImportDialog: on('openImportDialog'),
    onOpenSettingsDialog: on('openSettingsDialog'),
    onToggleSidebar: on('toggleSidebar'),
    onPluginsChanged: on('pluginsChanged'),
    onStatusBarChanged: on('statusBarChanged'),
    onChatChanged: on('chatChanged'),
    onChatLifecycle: on('chatLifecycle'),
    onUpdateChanged: on('updateChanged'),
  }

  // Every method goes through here, so calls are recorded and a test can swap one out. The theme
  // snapshot is a getter on `impl`, read through rather than copied, so it stays live. A call whose
  // arguments the contract's guard refuses is refused as main's registrar refuses it: an invoke
  // rejects, a send is dropped.
  const fake = { calls, state, emit } as unknown as FakeApiary
  for (const name of Object.keys(impl) as (keyof ApiaryApi)[]) {
    if (name === 'initialTheme') {
      Object.defineProperty(fake, name, { get: () => state.theme, enumerable: true })
      continue
    }
    const original = impl[name] as (...args: unknown[]) => unknown
    const spec = (IPC as Record<string, { kind: string; args?: (v: unknown) => boolean }>)[name]
    Object.defineProperty(fake, name, {
      enumerable: true,
      value: (...sent: unknown[]) => {
        calls.push({ name, args: sent })
        if (spec?.args !== undefined && !spec.args(sent)) {
          return spec.kind === 'invoke' ? Promise.reject(new Error('Invalid request.')) : undefined
        }
        // A value Electron's IPC could not carry (a function, a DOM node) fails here as it would there.
        // A subscription (`on…`) is not a channel: its argument is the callback, which stays itself.
        const copies = spec !== undefined
        const args = copies ? structuredClone(sent) : sent
        const swapped = overrides.get(name)
        const result = swapped !== undefined ? (swapped as (...a: unknown[]) => unknown)(...args) : original(...args)
        return copies && result instanceof Promise ? result.then((value: unknown) => structuredClone(value)) : result
      },
    })
  }
  fake.callsTo = (name) => calls.filter((c) => c.name === name).map((c) => c.args)
  fake.override = (name, fn) => { overrides.set(name, fn as (...args: never[]) => unknown) }
  return fake
}
