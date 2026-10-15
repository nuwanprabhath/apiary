import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MAIN_ACCOUNT_ID } from '@shared/domain/accounts'
import { asAccountId, asSessionId } from '@shared/domain/ids'
import { JsonStore } from '../../../src/main/fs/jsonStore'
import { AccountService, parseAccountsFile, type AccountsFile } from '../../../src/main/accounts/accountService'

let dir: string
let home: string
let mainRoot: string
let rows: Map<string, string>
let exec: ReturnType<typeof vi.fn>

function make(platform: NodeJS.Platform = 'linux', root = mainRoot): AccountService {
  return new AccountService({
    mainRoot: root, accountsDir: join(dir, 'accounts'), homeDir: home,
    store: new JsonStore<AccountsFile>({
      file: join(dir, 'accounts.json'), version: 1, parse: parseAccountsFile,
      fallback: () => ({ version: 1, accounts: [], defaultId: MAIN_ACCOUNT_ID }),
    }),
    sessions: { get: (id) => rows.get(id) ?? null, set: (id, a) => { rows.set(id, a) } },
    exec: exec as never, platform,
  })
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'apiary-accounts-'))
  home = join(dir, 'home')
  mainRoot = join(home, '.claude')
  mkdirSync(mainRoot, { recursive: true })
  rows = new Map()
  exec = vi.fn().mockResolvedValue('')
})
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('AccountService', () => {
  it("slug is unique and never 'main'", () => {
    const s = make()
    expect(s.add('Main')).toBe('main-2')
    expect(s.add('Work Team!')).toBe('work-team')
    expect(s.add('work team')).toBe('work-team-2')
  })

  it('remove refuses main', () => {
    expect(() => { make().remove(MAIN_ACCOUNT_ID) }).toThrow()
  })

  it('removing the default resets default to main', () => {
    const s = make()
    const id = s.add('Work')
    s.setDefault(id)
    expect(s.list().defaultId).toBe(id)
    s.remove(id)
    expect(s.list().defaultId).toBe(MAIN_ACCOUNT_ID)
    expect(existsSync(join(dir, 'accounts', id))).toBe(false)
    expect(make().list().accounts.map((a) => a.id)).toEqual([MAIN_ACCOUNT_ID])
  })

  it('envFor main is empty', () => {
    const s = make()
    expect(s.envFor(MAIN_ACCOUNT_ID)).toEqual({})
    expect(s.configRootFor(MAIN_ACCOUNT_ID)).toBe(mainRoot)
    const id = s.add('Work')
    expect(s.envFor(id)).toEqual({ CLAUDE_CONFIG_DIR: join(dir, 'accounts', id) })
  })

  it('resolve maps an unknown id to the default', () => {
    const s = make()
    const id = s.add('Work')
    s.setDefault(id)
    expect(s.resolve(asAccountId('ghost'))).toBe(id)
    expect(s.resolve(null)).toBe(id)
    expect(s.resolve(MAIN_ACCOUNT_ID)).toBe(MAIN_ACCOUNT_ID)
  })

  it('accountOf falls back after removal', () => {
    const s = make()
    const id = s.add('Work')
    const session = asSessionId('11111111-1111-1111-1111-111111111111')
    s.setAccountOf(session, id)
    expect(s.accountOf(session)).toBe(id)
    s.remove(id)
    expect(s.accountOf(session)).toBe(MAIN_ACCOUNT_ID)
  })

  it('email is read from .claude.json oauthAccount.emailAddress', () => {
    writeFileSync(join(home, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'me@main.dev' } }))
    const s = make()
    const id = s.add('Work')
    writeFileSync(join(dir, 'accounts', id, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'me@work.dev' } }))
    expect(s.list().accounts.map((a) => a.email)).toEqual(['me@main.dev', 'me@work.dev'])
  })

  it('the main email comes from <root>/.claude.json when the root is not ~/.claude', () => {
    const custom = join(dir, 'custom')
    mkdirSync(custom)
    writeFileSync(join(custom, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'c@x' } }))
    expect(make('linux', custom).list().accounts[0]?.email).toBe('c@x')
  })

  it('a corrupt .claude.json gives email null', () => {
    writeFileSync(join(home, '.claude.json'), '{nope')
    const s = make()
    const id = s.add('Work')
    expect(s.list().accounts.map((a) => a.email)).toEqual([null, null])
    expect(id).toBe('work')
  })

  it('prepareLaunch links and syncs an added account, and does nothing for main', () => {
    writeFileSync(join(home, '.claude.json'), JSON.stringify({ mcpServers: { a: 1 } }))
    const s = make()
    const id = s.add('Work')
    s.prepareLaunch(MAIN_ACCOUNT_ID)
    s.prepareLaunch(id)
    expect(existsSync(join(dir, 'accounts', id, '.claude.json'))).toBe(true)
  })

  it('tells listeners about a change until they unsubscribe', () => {
    const s = make()
    const fn = vi.fn()
    const off = s.onChanged(fn)
    s.add('Work')
    off()
    s.add('Other')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('deletes the Keychain item on darwin when an account is removed', async () => {
    const s = make('darwin')
    s.remove(s.add('Work'))
    await vi.waitFor(() => { expect(exec).toHaveBeenCalledTimes(1) })
  })
})

describe('a hand-edited accounts.json', () => {
  it('drops an id that is not a slug, so removing it can never delete outside accounts/', () => {
    const outside = join(dir, 'outside')
    mkdirSync(outside)
    writeFileSync(join(outside, 'keep.txt'), 'x')
    writeFileSync(join(dir, 'accounts.json'), JSON.stringify({
      version: 1, accounts: [{ id: '../outside', label: 'Evil' }, { id: 'work', label: 'Work' }], defaultId: '../outside',
    }))
    const s = make()
    expect(s.list().accounts.map((a) => a.id)).toEqual([MAIN_ACCOUNT_ID, 'work'])
    expect(s.defaultId()).toBe(MAIN_ACCOUNT_ID)
    expect(s.envFor(asAccountId('../outside'))).toEqual({})
    s.remove(asAccountId('../outside'))
    expect(existsSync(join(outside, 'keep.txt'))).toBe(true)
  })
})

describe('a login made in a terminal', () => {
  it('is announced once when an added account’s .claude.json gains an email', () => {
    const s = make()
    const id = s.add('Work')
    const heard = vi.fn()
    s.onChanged(heard)
    s.checkLogins()
    expect(heard).not.toHaveBeenCalled()

    writeFileSync(join(dir, 'accounts', id, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'w@example.com' } }))
    s.checkLogins()
    s.checkLogins()
    expect(heard).toHaveBeenCalledTimes(1)
    expect(s.list().accounts.find((a) => a.id === id)?.email).toBe('w@example.com')
  })

  it('is announced when the main account’s login changes (a global cswap switch)', () => {
    writeFileSync(join(home, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'a@example.com' } }))
    const s = make()
    const stop = s.startLoginChecks(60_000)
    const heard = vi.fn()
    s.onChanged(heard)
    writeFileSync(join(home, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'bee@example.com' } }))
    s.checkLogins()
    stop()
    expect(heard).toHaveBeenCalledTimes(1)
    expect(s.list().accounts[0]?.email).toBe('bee@example.com')
  })
})
