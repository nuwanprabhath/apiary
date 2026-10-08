import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConsentStore, memoryConsentStorage, type ConsentState } from '../../src/main/statusBar/claudeUsage/consent'
import { readAccessToken } from '../../src/main/statusBar/claudeUsage/credentials'
import { fetchLimits } from '../../src/main/statusBar/claudeUsage/limits'
import { createClaudeUsagePlugin } from '../../src/main/statusBar/claudeUsage/plugin'
import { StatusBarRegistry } from '../../src/main/statusBar/registry'
import { PluginService, type PluginServiceDeps } from '../../src/main/plugins/pluginService'
import { PluginRegistry } from '../../src/main/plugins/registry'

/**
 * Prevents: Apiary reading Claude Code's sign-in token (Keychain or credentials file) and sending
 * it to Anthropic on first launch, before the user was asked (2026-10-07 review §3.3, ADR-0019).
 * The injected `readKeychain` and `fetchImpl` are the two doors; neither may be opened first.
 */
const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

function setup(initial: ConsentState) {
  const root = mkdtempSync(join(tmpdir(), 'apiary-consent-'))
  dirs.push(root)
  writeFileSync(join(root, '.credentials.json'), '{"claudeAiOauth":{"accessToken":"from-file"}}')
  const calls = { keychain: 0, fetch: 0 }
  const storage = memoryConsentStorage(initial)
  const saved: ConsentState[] = []
  const consent = new ConsentStore({ load: () => storage.load(), save: (s) => { saved.push(s); storage.save(s) } })
  const timers: { fn: () => void; ms: number }[] = []
  const plugin = createClaudeUsagePlugin({
    configRoot: root, useKeychain: true, consent,
    readKeychain: async () => { calls.keychain++; return '{"claudeAiOauth":{"accessToken":"from-keychain"}}' },
    fetchImpl: async () => { calls.fetch++; return new Response(JSON.stringify({ five_hour: { utilization: 42 } }), { status: 200 }) },
    setTimeout: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t },
    clearTimeout: () => {},
  })
  let changes = 0
  plugin.start({ settings: () => ({}), changed: () => { changes++ } })
  return { plugin, consent, calls, saved, changes: () => changes }
}

describe('Claude usage consent', () => {
  it('before the user answers: no Keychain read, no credentials read, no network call, and a neutral item', async () => {
    const h = setup('unknown')
    await h.plugin.refresh()
    await h.plugin.refresh()
    expect(h.calls).toEqual({ keychain: 0, fetch: 0 })
    const [item, ...rest] = h.plugin.items()
    expect(item).toMatchObject({ text: 'Claude usage: allow access?', tone: 'normal', action: { kind: 'consent' } })
    expect(item.icon).not.toBe('alert')
    expect(rest).toEqual([])
    h.plugin.stop()
  })

  it('the prompt says what is read, where it goes, and that nothing is logged or stored', () => {
    const h = setup('unknown')
    const action = h.plugin.items()[0].action
    if (action.kind !== 'consent') throw new Error('expected a consent action')
    const text = action.prompt.lines.join(' ')
    expect(text).toMatch(/Keychain/)
    expect(text).toMatch(/credentials file/)
    expect(text).toMatch(/only to Anthropic’s usage endpoint/)
    expect(text).toMatch(/never logs or stores/)
    h.plugin.stop()
  })

  it('allow: remembers the answer, then reads the token and fetches the limits', async () => {
    const h = setup('unknown')
    h.plugin.answerConsent?.(true)
    expect(h.saved).toEqual(['granted'])
    await h.plugin.refresh()
    expect(h.calls).toEqual({ keychain: 1, fetch: 1 })
    expect(h.plugin.items()[0]).toMatchObject({ text: '5h 42%', action: { kind: 'panel' } })
    h.plugin.stop()
  })

  it('decline: remembers the answer and never touches the Keychain or the network', async () => {
    const h = setup('unknown')
    h.plugin.answerConsent?.(false)
    expect(h.saved).toEqual(['declined'])
    await h.plugin.refresh()
    expect(h.calls).toEqual({ keychain: 0, fetch: 0 })
    h.plugin.stop()
  })

  it('an install that ran the plugin before the prompt existed is asked too: a missing answer is "unknown"', async () => {
    const h = setup('unknown')
    expect(h.consent.state()).toBe('unknown')
    await h.plugin.refresh()
    expect(h.calls).toEqual({ keychain: 0, fetch: 0 })
    h.plugin.stop()
  })

  it('a granted answer from an earlier launch is honoured without asking again', async () => {
    const h = setup('granted')
    await h.plugin.refresh()
    expect(h.calls.fetch).toBe(1)
    expect(h.plugin.items()[0].action.kind).toBe('panel')
    h.plugin.stop()
  })

  it('switched back on after a decline, it asks again', () => {
    const h = setup('declined')
    expect(h.consent.state()).toBe('unknown')
    expect(h.plugin.items()[0].action.kind).toBe('consent')
    h.plugin.stop()
  })

  it('the credential functions cannot be called without the proof of an answer', () => {
    // Compile-time only: `tsc` fails these lines if the Consent parameter is ever dropped. Never called.
    const neverCalled = (): void => {
      // @ts-expect-error a Consent is required before a credential is read
      void readAccessToken({ configRoot: '/nowhere', useKeychain: false })
      // @ts-expect-error a Consent is required before the token is sent anywhere
      void fetchLimits('token', (async () => new Response('{}')) as unknown as typeof fetch)
    }
    expect(typeof neverCalled).toBe('function')
    expect(new ConsentStore(memoryConsentStorage('declined')).proof()).toBeUndefined()
    expect(new ConsentStore(memoryConsentStorage('unknown')).proof()).toBeUndefined()
    expect(new ConsentStore(memoryConsentStorage('granted')).proof()).toBeDefined()
  })
})

describe('declining the usage prompt through the plugin service', () => {
  function build(initial: ConsentState) {
    const storage = memoryConsentStorage(initial)
    const persisted: [string, boolean][] = []
    const statusBar = new StatusBarRegistry()
    const service = new PluginService({
      plugins: new PluginRegistry({ remoteUrl: async () => null }),
      statusBar,
      resolver: {} as unknown as PluginServiceDeps['resolver'],
      git: {} as unknown as PluginServiceDeps['git'],
      builtins: {
        enabled: undefined, settings: undefined, glabPath: undefined, configRoot: '/nowhere', useKeychain: false,
        consent: storage, persistEnabled: (id, enabled) => { persisted.push([id, enabled]) },
      },
    })
    service.startStatusBar()
    return { service, storage, persisted, statusBar }
  }

  it('turns the plugin off and remembers that it is off', () => {
    const { service, storage, persisted, statusBar } = build('unknown')
    expect(service.statusBarItems().map((i) => i.action.kind)).toEqual(['consent'])
    service.statusBarConsent('claude-usage', false)
    expect(storage.load()).toBe('declined')
    expect(statusBar.isEnabled('claude-usage')).toBe(false)
    expect(persisted).toEqual([['claude-usage', false]])
    expect(service.statusBarItems()).toEqual([])
    service.stopStatusBar()
  })

  it('allowing keeps the plugin on and persists nothing about enablement', () => {
    const { service, storage, persisted, statusBar } = build('unknown')
    service.statusBarConsent('claude-usage', true)
    expect(storage.load()).toBe('granted')
    expect(statusBar.isEnabled('claude-usage')).toBe(true)
    expect(persisted).toEqual([])
    service.stopStatusBar()
  })

  it('an answer for a plugin that is not there is ignored', () => {
    const { service, storage, persisted } = build('unknown')
    service.statusBarConsent('no-such-plugin', false)
    expect(storage.load()).toBe('unknown')
    expect(persisted).toEqual([])
    service.stopStatusBar()
  })

  it('re-enabling after a decline asks again', () => {
    const { service, storage } = build('unknown')
    service.statusBarConsent('claude-usage', false)
    service.setEnabled('claude-usage', true)
    expect(storage.load()).toBe('unknown')
    expect(service.statusBarItems().map((i) => i.action.kind)).toEqual(['consent'])
    service.stopStatusBar()
  })
})
