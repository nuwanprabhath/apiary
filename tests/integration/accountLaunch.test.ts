import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { asSessionId, type AccountId } from '@shared/domain/ids'
import { ClaudeOneShot } from '../../src/main/claude/claudeOneShot'
import { buildServices } from '../fixtures/buildService'
import { makeSession } from '../fixtures/makeSession'
import type { Services } from '../../src/main/app/container'

/**
 * Every `claude` Apiary starts runs under an account's environment. The stand-in `claude` writes the
 * CLAUDE_CONFIG_DIR it was started with, so these read what the process saw, not what the code meant.
 */
const FIXTURE = resolve(__dirname, '../fixtures/bin/fake-claude-env.sh')
const SID = asSessionId('11111111-1111-4111-8111-111111111111')

let home: string
let workdir: string
let out: string
let built: Services
let savedOut: string | undefined

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'apiary-acctlaunch-'))
  workdir = realpathSync(mkdtempSync(join(tmpdir(), 'apiary-acctwork-')))
  mkdirSync(join(home, '.claude', 'projects'), { recursive: true })
  const bin = join(home, 'claude')
  copyFileSync(FIXTURE, bin)
  chmodSync(bin, 0o755)
  out = join(home, 'env-seen.txt')
  savedOut = process.env.APIARY_ENV_OUT
  process.env.APIARY_ENV_OUT = out
  built = buildServices({
    configRoot: join(home, '.claude'), dbPath: join(home, 'apiary.db'), detectLive: async () => new Map(),
    claudeBin: bin, homeDir: home,
    accountsOutside: { exec: async () => '', platform: 'linux' },
  })
  makeSession(join(home, '.claude', 'projects'), '-w', { sessionId: SID, cwd: workdir, title: 'Fix CSV export' })
  await built.service.refresh()
  await built.service.importSessions([SID], [])
})
afterEach(async () => {
  await built.service.dispose()
  if (savedOut === undefined) delete process.env.APIARY_ENV_OUT
  else process.env.APIARY_ENV_OUT = savedOut
  rmSync(home, { recursive: true, force: true })
  rmSync(workdir, { recursive: true, force: true })
})

const seen = async (): Promise<string> => {
  await vi.waitFor(() => { expect(existsSync(out)).toBe(true) }, { timeout: 10_000 })
  return readFileSync(out, 'utf8')
}
const folderOf = (id: AccountId): string => join(home, 'accounts', id)
const addAccount = (label: string): AccountId => built.accounts.add(label)

describe('claude starts under an account', () => {
  it('a resumed terminal in an added account gets its folder', async () => {
    const work = addAccount('Work')
    built.accounts.setAccountOf(SID, work)
    await built.service.resume(SID)
    expect(await seen()).toBe(folderOf(work))
  })

  it('the main account leaves CLAUDE_CONFIG_DIR unset', async () => {
    await built.service.resume(SID)
    expect(await seen()).toBe('<unset>')
  })

  it('a chat start gets the session\'s account', async () => {
    const work = addAccount('Work')
    built.accounts.setAccountOf(SID, work)
    await built.service.chat.start(SID, { takeOver: false })
    expect(await seen()).toBe(folderOf(work))
  })

  it('a one-shot call gets the default account', async () => {
    const work = addAccount('Work')
    built.accounts.setDefault(work)
    const runner = new ClaudeOneShot({ claudeBin: () => join(home, 'claude'), shell: '/bin/sh', env: () => built.accounts.defaultEnv() })
    await runner.run({ prompt: 'hi', model: 'haiku', timeoutMs: 10_000, what: 'a pet', tag: 'acct' })
    expect(await seen()).toBe(folderOf(work))
  })

  it('a fork starts in its parent\'s account', async () => {
    const work = addAccount('Work')
    built.accounts.setAccountOf(SID, work)
    built.service.forkSession(SID)
    expect(await seen()).toBe(folderOf(work))
  })

  it('a new session starts in the default account', async () => {
    const work = addAccount('Work')
    built.accounts.setDefault(work)
    await built.service.newSessionInFolder(workdir)
    expect(await seen()).toBe(folderOf(work))
  })
})
