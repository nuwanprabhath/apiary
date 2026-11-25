import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { asSessionId } from '@shared/domain/ids'
import { makeSession } from '../../fixtures/makeSession'
import { REGENT_KIND } from '@shared/domain/residents'
import { createDriving } from '../../../src/main/app/drivingContainer'
import type { DeskParts } from '../../../src/main/desk/desk'
import { slackDesk } from '../../../src/main/desk/slackDesk'
import type { DeskControls } from '../../../src/main/residents/mcp/deskControl'
import { SlackBridge } from '../../../src/main/slack/slackBridge'
import { SlackStore } from '../../../src/main/slack/slackStore'
import type { Services } from '../../../src/main/app/servicesContainer'
import { buildServices } from '../../fixtures/buildService'
import { stays } from '../../fixtures/stays'
import { fakeSlack } from '../../fixtures/fakeSlack'
import { memoryCipher } from '../../fixtures/memoryCipher'

const FAKE = resolve(__dirname, '../../fixtures/fake-claude-chat.mjs')

let home: string
let workdir: string
let built: Services
let driver: ReturnType<typeof createDriving>
let savedRoot: string | undefined

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'apiary-slackdesk-'))
  workdir = realpathSync(mkdtempSync(join(tmpdir(), 'apiary-slackwork-')))
  const configRoot = join(home, '.claude')
  mkdirSync(join(configRoot, 'projects'), { recursive: true })
  savedRoot = process.env.APIARY_CONFIG_ROOT
  process.env.APIARY_CONFIG_ROOT = configRoot
  built = buildServices({
    configRoot, dbPath: join(home, 'apiary.db'), detectLive: async () => new Map(), claudeBin: FAKE, homeDir: home,
    accountsOutside: { exec: async () => '', platform: 'linux' },
  })
  const existing = asSessionId('11111111-1111-4111-8111-111111111111')
  makeSession(join(configRoot, 'projects'), '-w', { sessionId: existing, cwd: workdir, title: 'Existing work' })
  await built.service.refresh()
  await built.service.importSessions([existing], [])
  driver = createDriving({
    store: built.store, chat: built.service.chat, git: built.git, catalog: built.catalog,
    tabMover: { recentFirst: () => [] }, virtualContents: { list: () => [] },
  })
})
afterEach(async () => {
  driver.dispose()
  await built.service.dispose()
  if (savedRoot === undefined) delete process.env.APIARY_CONFIG_ROOT
  else process.env.APIARY_CONFIG_ROOT = savedRoot
  rmSync(home, { recursive: true, force: true })
  rmSync(workdir, { recursive: true, force: true })
})

describe('Slack to a session through Regent', () => {
  it("an owner's Slack message reaches a session through Regent and the session's answer comes back to the thread", async () => {
    const slack = fakeSlack()
    const store = new SlackStore(join(home, 'slack.json'), memoryCipher())
    let poll: () => void = () => {}
    const bridge = new SlackBridge({ store, api: slack, onResume: (p) => { poll = p; return () => {} } })
    await bridge.configure({ token: 'xoxb-test-token', channel: 'work', ownerId: slack.owner, enabled: true })

    // Regent is played by a stand-in that acts through the desk's real controls, as its tools do.
    let controls: DeskControls | null = null
    const turnListeners = new Set<(e: { residentId: string; text: string; origin: string }) => void>()
    const residents = {
      names: () => [{ id: 'regent', name: 'Regent', kindId: REGENT_KIND, state: 'idle', setupNeeded: null }],
      sendFrom: (_id: string, o: { text: string }) => {
        const thread = /^\[Slack task (\S+?)[\],]/.exec(o.text)?.[1] ?? ''
        const folder = controls?.drive.folders().find((f) => f.name === basename(workdir))
        void controls?.drive.start(folder?.id ?? '', 'build the thing', null, thread).then(async () => {
          await controls?.slack.post(thread, "Created a session in the folder and passed it your request.")
          for (const l of turnListeners) l({ residentId: 'regent', text: 'ok', origin: 'slack' })
        })
      },
      note: (_id: string, o: { text: string }) => {
        const thread = /task (\d+\.\d+)/.exec(o.text)?.[1]
        if (thread !== undefined && o.text.includes('Its turn ended')) void controls?.slack.finish(thread, 'The session finished.')
      },
      keepAwake: () => () => {},
      onTurnEnded: (l: (e: { residentId: string; text: string; origin: string }) => void) => { turnListeners.add(l); return () => { turnListeners.delete(l) } },
      setDesk: (d: DeskControls | null) => { controls = d },
    }
    const stop = slackDesk({ bridge, driver, residents } as unknown as DeskParts)
    const stopBridge = bridge.start()
    await vi.waitFor(() => { expect(slack.calls().history).toBeGreaterThan(0) })
    await stays(() => true, 60, 'the first poll has set the cursor')

    const thread = slack.ownerSays('please build the thing')
    poll()
    await vi.waitFor(() => {
      expect(slack.posts().some((p) => p.thread === thread && p.text === 'The session finished.')).toBe(true)
    }, { timeout: 20_000 })
    expect(slack.posts().some((p) => p.thread === thread && p.text.startsWith('Created a session'))).toBe(true)
    expect(bridge.tasks.get(thread)?.state).not.toBe('open')
    stop()
    await stopBridge()
  }, 40_000)
})
