import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { asSessionId } from '@shared/domain/ids'
import { MR_DESK_KIND, REGENT_KIND, type ResidentConfig } from '@shared/domain/residents'
import { createDriving } from '../../../src/main/app/drivingContainer'
import { createSlack } from '../../../src/main/app/slackContainer'
import { startDesk } from '../../../src/main/desk/desk'
import { kindOf, newResident } from '../../../src/main/residents/kinds'
import { ResidentService, type ResidentSettings } from '../../../src/main/residents/residentService'
import type { SlackBridge } from '../../../src/main/slack/slackBridge'
import type { Services } from '../../../src/main/app/container'
import { buildServices } from '../../fixtures/buildService'
import { fakeSlack, type FakeSlack } from '../../fixtures/fakeSlack'
import { git, initRepo } from '../../fixtures/gitRepo'
import { makeSession } from '../../fixtures/makeSession'
import { memoryCipher } from '../../fixtures/memoryCipher'
import { stays } from '../../fixtures/stays'

/**
 * The whole Slack flow as the app runs it: the real bridge, desk, driver, chats, git and
 * ResidentService with its MCP server. Only Slack and the claudes are stand-ins.
 */
const CHAT_CLAUDE = resolve(__dirname, '../../fixtures/fake-claude-chat.mjs')
const RESIDENT_CLAUDE = resolve(__dirname, '../../fixtures/fake-claude-resident.mjs')
const EXISTING = asSessionId('11111111-1111-4111-8111-111111111111')
const SLOW = { timeout: 30_000 }
// A Saturday at 03:00: both residents are off duty under their weekday schedule.
const OFF_DUTY = new Date(2026, 9, 31, 3, 0)

let home: string
let repo: string
let built: Services
let slack: FakeSlack
let bridge: SlackBridge
let residents: ResidentService
let stopDesk: () => Promise<void>
let poll: () => void
let scenarioFile: string
let savedRoot: string | undefined
let driver: ReturnType<typeof createDriving>

/** Writes Regent's script (and the MR desk's): each key is the start of a message. */
function script(scenarios: Record<string, unknown[]>): void {
  writeFileSync(scenarioFile, JSON.stringify({ path: '', scenarios }))
}
const step = (mcp: string, args: Record<string, unknown>): unknown => ({ mcp, args })
const posts = (thread: string): string[] => slack.posts().filter((p) => p.thread === thread).map((p) => p.text)
/** Polls Slack until the condition holds: a poll started mid-cycle is not lost this way. */
const until = (check: () => void, timeout = 30_000): Promise<void> => vi.waitFor(() => { poll(); check() }, { timeout, interval: 200 })
const regentHistory = (): { text: string; note: boolean }[] => residents.history('regent').map((m) => ({ text: m.text, note: m.note === true }))

beforeEach(async () => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'apiary-regentslack-')))
  repo = initRepo(join(home, 'work-repo'))
  const configRoot = join(home, '.claude')
  mkdirSync(join(configRoot, 'projects'), { recursive: true })
  savedRoot = process.env.APIARY_CONFIG_ROOT
  process.env.APIARY_CONFIG_ROOT = configRoot
  built = buildServices({
    configRoot, dbPath: join(home, 'apiary.db'), detectLive: async () => new Map(), claudeBin: CHAT_CLAUDE, homeDir: home,
    accountsOutside: { exec: async () => '', platform: 'linux' },
  })
  makeSession(join(configRoot, 'projects'), '-w', { sessionId: EXISTING, cwd: repo, title: 'Existing work' })
  await built.service.refresh()
  await built.service.importSessions([EXISTING], [])
  driver = createDriving({
    store: built.store, chat: built.service.chat, git: built.git, catalog: built.catalog,
    tabMover: { recentFirst: () => [] }, virtualContents: { list: () => [] },
  })

  // Resident claudes run through node, so the fixture needs no executable bit.
  const bin = join(home, 'claude')
  writeFileSync(bin, `#!/bin/sh\nexec node ${JSON.stringify(RESIDENT_CLAUDE)} "$@"\n`)
  chmodSync(bin, 0o755)
  scenarioFile = join(home, 'scenarios.json')
  script({})
  const schedule = { days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' }
  const regent: ResidentConfig = { ...newResident(kindOf(REGENT_KIND), new Set()), enabled: true, schedule }
  const desk: ResidentConfig = {
    ...newResident(kindOf(MR_DESK_KIND), new Set()), enabled: true, schedule, options: { project: 'g/p', repoPath: repo },
  }
  let list = [regent, desk]
  const settings: ResidentSettings = { get: () => list, set: (l) => { list = l }, onChange: () => () => {} }
  residents = new ResidentService({
    settings, root: join(home, 'residents'), knowledge: built.knowledge.service, digest: null, usagePercent: () => null,
    claudeBin: () => bin, launchEnv: () => ({ FAKE_RESIDENT_SCENARIOS: scenarioFile }),
    tools: {
      session: (id) => { const s = built.store.getSession(id); return s === null || s.archived ? null : { title: s.title ?? s.firstPrompt ?? 'Untitled session' } },
      openSession: () => {}, openTabs: () => [], focusedWindow: () => null,
    },
    onChanged: () => {}, onMessage: () => {}, version: '0.0.0', now: () => OFF_DUTY,
  })
  residents.start()

  slack = fakeSlack()
  bridge = createSlack({
    paths: { slackFile: join(home, 'slack.json') }, env: { slackApi: undefined }, cipher: memoryCipher(),
    onResume: (p) => { poll = p; return () => {} }, api: slack,
  })
  await bridge.configure({ token: 'xoxb-test-token', channel: 'work', ownerId: slack.owner, enabled: true })
  stopDesk = startDesk({ bridge, driver, residents })
  await vi.waitFor(() => { if ((slack.calls().history ?? 0) === 0) throw new Error('Slack has not been polled yet') })
  // The first poll set the cursor; a message must come after it.
  await stays(() => true, 60, 'the first poll has set the cursor')
}, 30_000)

afterEach(async () => {
  await stopDesk()
  await residents.dispose()
  driver.dispose()
  await built.service.dispose()
  if (savedRoot === undefined) delete process.env.APIARY_CONFIG_ROOT
  else process.env.APIARY_CONFIG_ROOT = savedRoot
  rmSync(home, { recursive: true, force: true })
})

describe('Regent over Slack', () => {
  it("a Slack task reaches an existing session through Regent, and Regent's post and the session's finished turn come back to the thread", async () => {
    const thread = slack.ownerSays('continue the existing work')
    script({
      [`[Slack task ${thread}]`]: [
        step('find_sessions', { query: 'Existing work' }),
        step('send_to_session', { sessionId: EXISTING, text: 'please continue', taskId: thread }),
        step('slack_post', { taskId: thread, text: 'Found "Existing work" and passed it your request.' }),
        { text: 'Done.' },
      ],
      [`[Session event, task ${thread}`]: [step('finish_task', { taskId: thread, summary: 'The session finished.' }), { text: 'Closed.' }],
    })
    poll()
    await until(() => { expect(posts(thread)).toContain('The session finished.') }, 60_000)
    expect(slack.reactions()).toContainEqual({ ts: thread, name: 'eyes' })
    expect(posts(thread)[0]).toContain('Found "Existing work"')
    expect(regentHistory().some((m) => m.note && m.text.includes('finished a turn'))).toBe(true)
    expect(bridge.tasks.get(thread)?.state).not.toBe('open')
  }, 90_000)

  it('a Slack task that fits no session starts one in a new worktree', async () => {
    const folder = driver.folders().find((f) => f.name === 'work-repo')
    const thread = slack.ownerSays('build the widget in its own worktree')
    script({
      [`[Slack task ${thread}]`]: [
        step('list_folders', {}),
        step('start_session', { folderId: folder?.id, text: 'build the widget', taskId: thread, worktree: { name: 'widget-wt', branch: 'feat/widget', newBranch: true } }),
        { text: 'Started.' },
      ],
      [`[Session event, task ${thread}`]: [step('finish_task', { taskId: thread, summary: 'Built.' })],
    })
    poll()
    await until(() => { expect(posts(thread)).toContain('Built.') }, 60_000)
    const worktrees = git(repo, 'worktree', 'list')
    expect(worktrees).toContain('widget-wt')
    await vi.waitFor(() => {
      const known = built.store.allProjects().find((p) => p.path.endsWith('widget-wt'))
      expect(known).toBeDefined()
    }, SLOW)
    const started = built.store.allSessions().find((s) => (s.cwd ?? '').endsWith('widget-wt'))
    expect(started?.firstPrompt).toContain('build the widget')
  }, 90_000)

  it('a session\'s permission prompt is answered from the thread, and allow all covers its next one', async () => {
    const thread = slack.ownerSays('run the check in the existing session')
    const asks = (): number => posts(thread).filter((t) => t.includes('Reply allow, deny, or allow all')).length
    script({
      [`[Slack task ${thread}]`]: [step('send_to_session', { sessionId: EXISTING, text: 'permission please', taskId: thread }), { text: 'Sent.' }],
      [`[Session event, task ${thread}`]: [{ text: 'noted' }],
    })
    poll()
    await until(() => { expect(asks()).toBe(1) }, 60_000)
    expect(posts(thread).find((t) => t.includes('wants to'))).toBeDefined()
    slack.ownerSays('allow all', { thread })
    await until(() => { expect(regentHistory().some((m) => m.note && m.text.includes('finished a turn'))).toBe(true) }, 60_000)
    // The chat's next prompt for permission is answered by main, with no second card.
    script({
      [`[Session event, task ${thread}`]: [{ text: 'noted' }, step('finish_task', { taskId: thread, summary: 'All done.' })],
    })
    await driver.send(EXISTING, 'permission again')
    await until(() => { expect(posts(thread)).toContain('All done.') }, 60_000)
    expect(asks()).toBe(1)
  }, 120_000)

  it('check my MR desk asks the desk off duty and relays its answer', async () => {
    const thread = slack.ownerSays('check my MRs')
    const name = residents.list().find((r) => r.kind === MR_DESK_KIND)?.name ?? 'MR desk'
    script({
      [`[Slack task ${thread}]`]: [step('run_resident_check', { name, taskId: thread }), { text: 'Asked the desk.' }],
      'Run one MR desk cycle.': [{ text: 'Two MRs wait on you.' }],
      [`[Resident event, task ${thread}`]: [step('finish_task', { taskId: thread, summary: 'The desk says two MRs wait.' })],
    })
    poll()
    await until(() => { expect(posts(thread)).toContain('The desk says two MRs wait.') }, 60_000)
    expect(regentHistory().some((m) => m.note && m.text.includes('answered'))).toBe(true)
  }, 90_000)

  it('a message from someone else is ignored and status and stop answer without a model', async () => {
    slack.otherSays('please delete everything')
    const statusThread = slack.ownerSays('status')
    await until(() => { expect(posts(statusThread).length).toBeGreaterThan(0) })
    slack.ownerSays('stop', { thread: statusThread })
    await until(() => { expect(posts(statusThread).length).toBeGreaterThan(1) })
    expect(slack.posts().every((p) => p.thread === statusThread)).toBe(true)
    expect(regentHistory()).toEqual([])
    expect(residents.list().find((r) => r.id === 'regent')?.state).not.toBe('running')
  }, 60_000)
})
