import { contextMenuRequestFrom, isEditCommand, type ContextMenuParamsLike } from '@shared/domain/contextMenu'
import { defineBridgeContract, LONG_SESSION } from '../contract/bridgeContract'
import { BAR_ITEM, BAR_PLUGIN, CONSENT_ITEM, CONSENT_PLUGIN, FEED_VERSION, STATUS_ITEM, STATUS_PANEL, STATUS_PLUGIN } from '../contract/world'
import { createFakeApiary, FIXTURE_PROJECTS, FIXTURE_SESSIONS, fakeRef, message, type FakeSession } from './fakeApiary'

// The fake against the shared behavioural spec; the real main process runs the same spec in
// tests/integration/contract.test.ts (TEST-5). What the spec is configured with — the plugins, the
// update feed, the remote, the folders — is the fake's half of `tests/contract/world.ts` and of the
// loopback's world.
defineBridgeContract('fakeApiary', async ({ imported = true, longSessionMessages, liveSession, cancelPicker = false }) => {
  const sessions: FakeSession[] = FIXTURE_SESSIONS.map((s) => (s.sessionId === liveSession ? { ...s, isLive: true } : s))
  if (longSessionMessages !== undefined) {
    const messages = [message('u1', 'user', 'fix the export')]
    for (let i = 0; i < longSessionMessages - 2; i++) messages.push(message(`a${String(i)}`, 'assistant', `pad-${String(i)}`))
    messages.push(message('last', 'assistant', 'done'))
    sessions.push({ sessionId: LONG_SESSION.id, title: LONG_SESSION.title, projectPath: '/fixture/work-a', gitBranch: 'main', messages })
  }
  const fake = createFakeApiary({
    sessions,
    // The plain folders are not repositories; `repo-c` is, with a worktree on `feature/wt`.
    projects: FIXTURE_PROJECTS.map((p) => (p.branch === null ? { ...p, notRepo: true } : p)),
    imported: imported ? 'all' : 'none',
    // `main` tracks `origin/main`, and `origin` also has `release/1`.
    refs: { remote: [fakeRef('origin/main'), fakeRef('origin/release/1')], tags: [] },
    upstream: ['main'],
    plugins: [
      { ...BAR_PLUGIN, fields: [...BAR_PLUGIN.fields], enabled: true, values: { level: 3 } },
      { ...STATUS_PLUGIN, fields: [...STATUS_PLUGIN.fields], enabled: true, values: {} },
      { ...CONSENT_PLUGIN, fields: [...CONSENT_PLUGIN.fields], enabled: true, values: {} },
    ],
    pluginBar: [{ ...BAR_ITEM, pluginId: BAR_PLUGIN.id }],
    statusBar: [{ ...STATUS_ITEM, pluginId: STATUS_PLUGIN.id }, { ...CONSENT_ITEM, pluginId: CONSENT_PLUGIN.id }],
    statusBarPanel: STATUS_PANEL,
    updateFeed: FEED_VERSION,
    pickedFolder: cancelPicker ? null : '/fixture/picked',
  })
  const main = (): NonNullable<ReturnType<typeof fake.state.tracking.get>> => {
    const t = fake.state.tracking.get('main')
    if (t === undefined) throw new Error('main has no upstream in this fake')
    return t
  }
  return Promise.resolve({
    api: fake,
    folders: {
      workA: '/fixture/work-a', workB: '/fixture/work-b', repo: '/fixture/repo-c', worktree: '/fixture/repo-c-wt', picked: '/fixture/picked',
    },
    openedUrls: () => [...fake.state.opened],
    copied: () => [...fake.state.copied],
    editing: () => fake.callsTo('editCommand').map(([command]) => command).filter(isEditCommand),
    rightClick: (params: ContextMenuParamsLike) => { fake.emit('contextMenuRequested', contextMenuRequestFrom(params)) },
    outside: {
      commitLocally: () => { main().ahead += 1; return Promise.resolve() },
      advanceRemote: () => { main().pending += 1; return Promise.resolve() },
    },
    cleanup: () => {},
  })
})
