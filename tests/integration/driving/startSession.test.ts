import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { asSessionId } from '@shared/domain/ids'
import { createDriving } from '../../../src/main/app/drivingContainer'
import type { SessionEvent } from '../../../src/main/driving/sessionDriver'
import { buildServices } from '../../fixtures/buildService'
import { makeSession } from '../../fixtures/makeSession'
import type { Services } from '../../../src/main/app/container'

/** The real services around a temp folder, `claude` being the chat fixture. */
const FAKE = resolve(__dirname, '../../fixtures/fake-claude-chat.mjs')
const EXISTING = asSessionId('11111111-1111-4111-8111-111111111111')

let home: string
let workdir: string
let built: Services
let driver: ReturnType<typeof createDriving>
let events: SessionEvent[]
let savedRoot: string | undefined

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'apiary-driving-'))
  workdir = realpathSync(mkdtempSync(join(tmpdir(), 'apiary-drivework-')))
  const configRoot = join(home, '.claude')
  mkdirSync(join(configRoot, 'projects'), { recursive: true })
  savedRoot = process.env.APIARY_CONFIG_ROOT
  process.env.APIARY_CONFIG_ROOT = configRoot
  built = buildServices({
    configRoot, dbPath: join(home, 'apiary.db'), detectLive: async () => new Map(), claudeBin: FAKE, homeDir: home,
    accountsOutside: { exec: async () => '', platform: 'linux' },
  })
  makeSession(join(configRoot, 'projects'), '-w', { sessionId: EXISTING, cwd: workdir, title: 'Existing work' })
  await built.service.refresh()
  await built.service.importSessions([EXISTING], [])
  driver = createDriving({
    store: built.store, chat: built.service.chat, git: built.git, catalog: built.catalog,
    tabMover: { recentFirst: () => [] }, virtualContents: { list: () => [] },
  })
  events = []
  driver.onEvent((e) => events.push(e))
})
afterEach(async () => {
  driver.dispose()
  await built.service.dispose()
  if (savedRoot === undefined) delete process.env.APIARY_CONFIG_ROOT
  else process.env.APIARY_CONFIG_ROOT = savedRoot
  rmSync(home, { recursive: true, force: true })
  rmSync(workdir, { recursive: true, force: true })
})

const turnEnds = (): string[] => events.flatMap((e) => (e.kind === 'turn-ended' ? [e.text] : []))

describe('driving real sessions', () => {
  it('a new session started with a message appears in the store with that first prompt and its turn end is reported', async () => {
    const folder = driver.folders().find((f) => f.name === basename(workdir))
    expect(folder).toBeDefined()
    const { sessionId } = await driver.startSession(folder?.id ?? '', 'build the thing')
    expect(built.store.getSession(sessionId)?.firstPrompt).toContain('build the thing')
    driver.watch(sessionId)
    built.service.chat.send(sessionId, 'and test it')
    await vi.waitFor(() => { expect(turnEnds()).toContain('You said: and test it') }, { timeout: 15_000 })
  }, 30_000)

  it('a message sent to an existing session is answered and reported', async () => {
    driver.watch(EXISTING)
    expect(await driver.send(EXISTING, 'hello there')).toBe('sent')
    await vi.waitFor(() => { expect(turnEnds()).toContain('You said: hello there') }, { timeout: 15_000 })
  }, 30_000)
})
