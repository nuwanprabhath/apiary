import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MAIN_ACCOUNT_ID, type AccountInfo, type AccountsState } from '@shared/domain/accounts'
import { asAccountId } from '@shared/domain/ids'
import { keychainServiceFor } from '../../src/main/accounts/keychainName'
import { ConsentStore, memoryConsentStorage, type ConsentState } from '../../src/main/statusBar/claudeUsage/consent'
import { CONSENT_PROMPT } from '../../src/main/statusBar/claudeUsage/credentials'
import { createClaudeUsagePlugin } from '../../src/main/statusBar/claudeUsage/plugin'

const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'apiary-usage-acc-'))
  dirs.push(d)
  return d
}

const info = (id: string, label: string, email: string | null): AccountInfo =>
  ({ id: asAccountId(id), label, email, isMain: id === 'main' })
const tokenJson = (t: string): string => JSON.stringify({ claudeAiOauth: { accessToken: t } })

interface Timer { fn: () => void; ms: number }

interface HarnessOptions {
  accounts: AccountInfo[]
  consent?: ConsentState
  useKeychain?: boolean
  /** Keychain tokens by account id. */
  keychain?: Record<string, string>
  /** `.credentials.json` tokens by account id. */
  files?: Record<string, string>
}

function harness(opts: HarnessOptions) {
  const main = tmp()
  mkdirSync(join(main, 'projects'))
  const folders = new Map<string, string>([[MAIN_ACCOUNT_ID, main]])
  const state: AccountsState = { accounts: opts.accounts, defaultId: MAIN_ACCOUNT_ID }
  const root = tmp()
  for (const a of opts.accounts) if (!a.isMain) folders.set(a.id, join(root, a.id))
  for (const [id, token] of Object.entries(opts.files ?? {})) {
    const folder = folders.get(id) as string
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, '.credentials.json'), tokenJson(token))
  }
  const listeners = new Set<() => void>()
  const keychainReads: string[] = []
  const fetched: string[] = []
  const failing = new Set<string>()
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const auth = (init.headers as Record<string, string>).Authorization
    fetched.push(auth)
    if (failing.has(auth)) return new Response('', { status: 500 })
    return new Response(JSON.stringify({ five_hour: { utilization: auth.endsWith('work-tok') ? 70 : 10 } }), { status: 200 })
  }) as unknown as typeof fetch
  const timers: Timer[] = []
  const plugin = createClaudeUsagePlugin({
    configRoot: main, useKeychain: opts.useKeychain ?? false, fetchImpl,
    consent: new ConsentStore(memoryConsentStorage(opts.consent ?? 'granted')),
    accounts: {
      list: () => state,
      configRootFor: (id) => folders.get(id) ?? main,
      onChanged: (fn) => { listeners.add(fn); return () => { listeners.delete(fn) } },
    },
    readKeychain: async (service) => {
      keychainReads.push(service)
      const id = [...folders.keys()].find((k) => keychainServiceFor(k === MAIN_ACCOUNT_ID ? null : folders.get(k) ?? '') === service)
      return id === undefined || opts.keychain?.[id] === undefined ? undefined : tokenJson(opts.keychain[id])
    },
    setTimeout: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t },
    clearTimeout: (h) => { const i = timers.indexOf(h as Timer); if (i >= 0) timers.splice(i, 1) },
  })
  plugin.start({ settings: () => ({}), changed: () => {} })
  const change = (accounts: AccountInfo[]): void => { state.accounts = accounts; for (const fn of listeners) fn() }
  return { plugin, timers, fetched, failing, keychainReads, folders, change }
}

const TWO = [info('main', 'Main', 'me@x.com'), info('work', 'Work', 'work@x.com')]

describe('the usage plugin with several accounts', () => {
  it('polls every logged-in account and emits usage:<id> items', async () => {
    const h = harness({ accounts: [...TWO, info('ghost', 'Ghost', null)], files: { main: 'main-tok', work: 'work-tok', ghost: 'ghost-tok' } })
    await h.plugin.refresh()
    expect(h.plugin.items().map((i) => i.id)).toEqual(['usage', 'usage:work', 'refresh'])
    expect(h.fetched.sort()).toEqual(['Bearer main-tok', 'Bearer work-tok'])
    expect(h.plugin.items()[1]).toMatchObject({ text: 'Work · 5h 70%', title: 'Claude usage (Work)' })
    expect(h.plugin.items()[0]).toMatchObject({ text: 'Main · 5h 10%' })
    h.plugin.stop()
  })

  it('main keeps the id usage, and with one account every string is as before', async () => {
    const h = harness({ accounts: [info('main', 'Main', 'me@x.com')], files: { main: 'main-tok' } })
    await h.plugin.refresh()
    expect(h.plugin.items()[0]).toMatchObject({ id: 'usage', text: '5h 10%', title: 'Claude usage' })
    h.plugin.stop()
  })

  it('reads an added account\'s token from its own Keychain name, then its .credentials.json', async () => {
    const h = harness({ accounts: TWO, useKeychain: true, files: { work: 'work-tok' } })
    const workService = keychainServiceFor(h.folders.get('work') as string)
    expect(workService).toMatch(/^Claude Code-credentials-[0-9a-f]{8}$/)
    await h.plugin.refresh()
    expect([...h.keychainReads].sort()).toEqual([keychainServiceFor(null), workService].sort())
    // The Keychain had nothing for work, so its file was used.
    expect(h.fetched).toEqual(['Bearer work-tok'])
    h.plugin.stop()

    // A Keychain item wins over the file.
    const withKeychain = harness({ accounts: TWO, useKeychain: true, keychain: { work: 'kc-work-tok' }, files: { work: 'file-tok' } })
    await withKeychain.plugin.refresh()
    expect(withKeychain.fetched).toEqual(['Bearer kc-work-tok'])
    withKeychain.plugin.stop()
  })

  it('nothing is read before consent, for any account', async () => {
    const h = harness({ accounts: TWO, consent: 'unknown', useKeychain: true, files: { main: 'a', work: 'b' } })
    await h.plugin.refresh()
    expect(h.keychainReads).toEqual([])
    expect(h.fetched).toEqual([])
    expect(h.plugin.items().map((i) => i.id)).toEqual(['usage'])
    h.plugin.stop()
  })

  it('asks one question that covers every account', () => {
    expect(CONSENT_PROMPT.lines.join(' ')).toContain('the sign-in of each Claude account you use in Apiary')
  })

  it('limits and backoff are per account', async () => {
    const h = harness({ accounts: TWO, files: { main: 'main-tok', work: 'work-tok' } })
    await h.plugin.refresh()
    h.failing.add('Bearer work-tok')
    await h.plugin.refresh()
    const [main, work] = h.plugin.items()
    expect(main).toMatchObject({ text: 'Main · 5h 10%' })
    expect(main.stale).toBeFalsy()
    expect(work).toMatchObject({ text: 'Work · 5h 70%', stale: true })
    // Main's timer is at the normal interval; work's is backed off beyond it.
    const delays = h.timers.map((t) => t.ms).sort((a, b) => a - b)
    expect(delays[0]).toBe(5 * 60_000)
    expect(delays[1]).toBeGreaterThan(5 * 60_000)
    h.plugin.stop()
  })

  it('a removed account\'s item goes away, and an added one appears', async () => {
    const h = harness({ accounts: TWO, files: { main: 'main-tok', work: 'work-tok' } })
    await h.plugin.refresh()
    expect(h.timers).toHaveLength(2)
    h.change([TWO[0]])
    expect(h.plugin.items().map((i) => i.id)).toEqual(['usage', 'refresh'])
    expect(h.timers).toHaveLength(1)
    h.change([...TWO, info('home', 'Home', 'h@x.com')])
    expect(h.plugin.items().map((i) => i.id)).toEqual(['usage', 'usage:work', 'usage:home', 'refresh'])
    h.plugin.stop()
  })
})
