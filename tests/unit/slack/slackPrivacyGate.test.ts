import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SlackBridge, WAITING_FOR_CONSENT } from '../../../src/main/slack/slackBridge'
import { migrateSlackConsent } from '../../../src/main/slack/slackConsent'
import { SlackStore } from '../../../src/main/slack/slackStore'
import { fakeSlack } from '../../fixtures/fakeSlack'
import { memoryCipher } from '../../fixtures/memoryCipher'

const file = (): string => join(mkdtempSync(join(tmpdir(), 'apiary-slackgate-')), 'slack.json')

function gate(allowed: boolean) {
  const listeners = new Set<() => void>()
  const g = {
    allowed,
    granted: [] as string[],
    strict: () => true,
    allows: () => g.allowed,
    onChange: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } },
    set: (v: boolean) => { g.allowed = v; for (const fn of listeners) fn() },
    grant: async (_f: 'slackBridge', source: 'migrated') => { g.granted.push(source) },
  }
  return g
}

let stops: (() => Promise<void>)[] = []

async function setup(allowed: boolean) {
  const slack = fakeSlack({ now: Date.now })
  const store = new SlackStore(file(), memoryCipher())
  const g = gate(allowed)
  const bridge = new SlackBridge({ store, api: slack, now: Date.now, gate: g })
  await bridge.configure({ token: 'xoxb-test-token', channel: 'work', ownerId: slack.owner, enabled: true })
  stops.push(bridge.start())
  return { slack, store, g, bridge }
}

describe('Slack privacy gate', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-19T10:00:00Z')); stops = [] })
  afterEach(async () => { for (const stop of stops) await stop(); vi.useRealTimers() })

  it('does not poll without consent, and says it is waiting', async () => {
    const { slack, bridge } = await setup(false)
    const before = slack.calls().history ?? 0
    await vi.advanceTimersByTimeAsync(60_000)
    expect(slack.calls().history ?? 0).toBe(before)
    expect(bridge.status().connection).toBe('off')
    expect(bridge.status().error).toBe(WAITING_FOR_CONSENT)
  })

  it('starts polling on a grant and stops on a revoke, keeping its state', async () => {
    const { slack, store, g, bridge } = await setup(false)
    g.set(true)
    await vi.advanceTimersByTimeAsync(1)
    expect(slack.calls().history ?? 0).toBeGreaterThan(0)
    expect(bridge.status().connection).toBe('connected')
    g.set(false)
    const polled = slack.calls().history ?? 0
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(slack.calls().history ?? 0).toBe(polled)
    expect(bridge.status().connection).toBe('off')
    expect(store.state.enabled).toBe(true)
    expect(store.state.cursor).not.toBeNull()
  })

  it('a gate that throws counts as not allowed', async () => {
    const slack = fakeSlack({ now: Date.now })
    const store = new SlackStore(file(), memoryCipher())
    const bridge = new SlackBridge({ store, api: slack, now: Date.now, gate: { allows: () => { throw new Error('boom') }, onChange: () => () => {} } })
    await bridge.configure({ token: 'xoxb-test-token', channel: 'work', ownerId: slack.owner, enabled: true })
    stops.push(bridge.start())
    await vi.advanceTimersByTimeAsync(60_000)
    expect(bridge.status().connection).toBe('off')
  })

  it('records the carried-over consent once, and never again after the person revokes', () => {
    const path = file()
    const store = new SlackStore(path, memoryCipher())
    store.update({ enabled: true })
    const g = gate(false)
    migrateSlackConsent(store, g)
    expect(g.granted).toEqual(['migrated'])
    expect(readFileSync(path, 'utf8')).toContain('"slackConsentMigrated": true')
    const restarted = new SlackStore(path, memoryCipher())
    migrateSlackConsent(restarted, g)
    expect(g.granted).toEqual(['migrated'])
  })

  it('does not migrate a Slack that was never on', () => {
    const store = new SlackStore(file(), memoryCipher())
    const g = gate(false)
    migrateSlackConsent(store, g)
    expect(g.granted).toEqual([])
  })

  it('keeps the awaiting text encrypted on disk, re-encrypts an old plaintext one and drops one that cannot be read', async () => {
    const path = file()
    const store = new SlackStore(path, memoryCipher())
    store.update({ awaiting: [{ ts: '1.1', text: 'secret plan', askedAt: 5 }] })
    await store.ready()
    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(() => { expect(readFileSync(path, 'utf8')).toContain('sealed') })
    expect(readFileSync(path, 'utf8')).not.toContain('secret plan')
    const again = new SlackStore(path, memoryCipher())
    await again.ready()
    expect(again.state.awaiting).toEqual([{ ts: '1.1', text: 'secret plan', askedAt: 5 }])

    const old = file()
    const legacy = new SlackStore(old, memoryCipher())
    legacy.update({ awaiting: [] })
    await legacy.ready()
    const bad = { sealed: 'not-decryptable', ts: '2.2', askedAt: 6 }
    const fs = await import('node:fs')
    fs.writeFileSync(old, JSON.stringify({ version: 1, enabled: false, awaiting: [{ ts: '3.3', text: 'old plain', askedAt: 7 }, bad] }))
    const reopened = new SlackStore(old, { ...memoryCipher(), decrypt: async () => { throw new Error('rotated') } })
    await reopened.ready()
    expect(reopened.state.awaiting).toEqual([{ ts: '3.3', text: 'old plain', askedAt: 7 }])
    expect(readFileSync(old, 'utf8')).not.toContain('old plain')
  })
})
