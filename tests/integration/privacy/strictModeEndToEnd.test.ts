import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPrivacyGate } from '../../../src/main/privacy/privacyGate'
import { SettingsService } from '../../../src/main/settings/settingsService'
import { SlackBridge } from '../../../src/main/slack/slackBridge'
import { migrateSlackConsent } from '../../../src/main/slack/slackConsent'
import { SlackStore } from '../../../src/main/slack/slackStore'
import { fakeSlack } from '../../fixtures/fakeSlack'
import { memoryCipher } from '../../fixtures/memoryCipher'
import { FRIDAY, build, regent } from '../residents/support'

const cycle = { cycle: { everyMinutes: 1, prompt: 'check the desk', doing: 'Checking' } }
const folder = (): string => mkdtempSync(join(tmpdir(), 'apiary-strict-'))
const resumed = (calls: string[]): boolean => calls.some((c) => c.startsWith('resume'))

let stops: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const stop of stops) await stop()
  stops = []
})

/** Real settings file and gate; real resident service and Slack bridge on top; fake `claude` and Slack. */
async function world(file: string, regentEnabled: boolean) {
  const settings = new SettingsService(file)
  const gate = createPrivacyGate(settings)
  const resident = build(regentEnabled ? [regent()] : [], { privacyGate: gate, kinds: cycle })
  const slack = fakeSlack({ now: Date.now })
  const store = new SlackStore(join(folder(), 'slack.json'), memoryCipher())
  const bridge = new SlackBridge({ store, api: slack, now: Date.now, gate })
  await bridge.configure({ token: 'xoxb-test-token', channel: 'work', ownerId: slack.owner, enabled: true })
  return { settings, gate, resident, slack, store, bridge }
}

async function startAll(w: Awaited<ReturnType<typeof world>>): Promise<void> {
  w.resident.service.start()
  stops.push(w.bridge.start())
  await vi.advanceTimersByTimeAsync(1)
}

const polls = (w: Awaited<ReturnType<typeof world>>): number => w.slack.calls().history ?? 0
const cycles = (w: Awaited<ReturnType<typeof world>>): number => w.resident.service.history('regent').filter((m) => m.text === 'check the desk').length

describe('strict privacy mode, end to end', () => {
  it('holds the digest, the Slack poll and the cycle until each is granted, and stops them on a revoke', async () => {
    vi.setSystemTime(FRIDAY(12))
    const w = await world(join(folder(), 'settings.json'), true)
    expect(w.gate.strict()).toBe(true)
    await startAll(w)
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(resumed(w.resident.digest.calls)).toBe(false)
    expect(polls(w)).toBe(0)
    expect(cycles(w)).toBe(0)
    expect(w.resident.service.history('regent')).toEqual([])

    await w.gate.grant('backgroundDigest')
    expect(resumed(w.resident.digest.calls)).toBe(true)
    expect(polls(w)).toBe(0)
    expect(cycles(w)).toBe(0)

    await w.gate.grant('slackBridge')
    await vi.advanceTimersByTimeAsync(1)
    expect(polls(w)).toBeGreaterThan(0)
    expect(cycles(w)).toBe(0)

    await w.gate.grant('residentCycles')
    await vi.advanceTimersByTimeAsync(2 * 60_000)
    await vi.waitFor(() => { expect(cycles(w)).toBe(1) })

    await w.gate.revoke('slackBridge')
    await w.gate.revoke('residentCycles')
    await w.gate.revoke('backgroundDigest')
    const polled = polls(w)
    const ran = cycles(w)
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(polls(w)).toBe(polled)
    expect(cycles(w)).toBe(ran)
    expect(w.resident.digest.calls.at(-1)).toBe('pause')
    expect(w.resident.digest.shouldPause?.()).toBe(true)
  })

  it('runs all three with no consents when strict mode is off', async () => {
    vi.setSystemTime(FRIDAY(12))
    const w = await world(join(folder(), 'settings.json'), true)
    w.settings.patch({ gdprStrictMode: false })
    await startAll(w)
    await vi.advanceTimersByTimeAsync(2 * 60_000)
    expect(resumed(w.resident.digest.calls)).toBe(true)
    expect(polls(w)).toBeGreaterThan(0)
    await vi.waitFor(() => { expect(cycles(w)).toBeGreaterThan(0) })
    expect(w.settings.get().privacyConsents).toEqual({})
  })

  it('turning strict mode back on stops what no consent covers', async () => {
    vi.setSystemTime(FRIDAY(12))
    const w = await world(join(folder(), 'settings.json'), true)
    w.settings.patch({ gdprStrictMode: false })
    await startAll(w)
    expect(resumed(w.resident.digest.calls)).toBe(true)
    w.settings.patch({ gdprStrictMode: true })
    const polled = polls(w)
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(w.resident.digest.calls.at(-1)).toBe('pause')
    expect(polls(w)).toBe(polled)
  })
})

describe('a settings.json from before Settings → Privacy', () => {
  it('turns strict on and records migrated consents, and the digest keeps running', async () => {
    vi.setSystemTime(FRIDAY(12))
    const dir = folder()
    const file = join(dir, 'settings.json')
    writeFileSync(file, JSON.stringify({ schemaVersion: 3, residents: [regent()], plugins: {} }))
    const slackFile = join(dir, 'slack.json')
    const seed = new SlackStore(slackFile, memoryCipher())
    seed.update({ enabled: true })

    const settings = new SettingsService(file)
    const gate = createPrivacyGate(settings)
    const store = new SlackStore(slackFile, memoryCipher())
    migrateSlackConsent(store, gate)
    await vi.advanceTimersByTimeAsync(1)

    expect(gate.strict()).toBe(true)
    const consents = settings.get().privacyConsents
    for (const feature of ['backgroundDigest', 'residentCycles', 'slackBridge'] as const) expect(consents[feature]?.source).toBe('migrated')
    expect(readFileSync(file, 'utf8')).toMatch(/"gdprStrictMode": true/)

    const { service, digest } = build([regent()], { privacyGate: gate })
    service.start()
    expect(resumed(digest.calls)).toBe(true)
    expect(digest.calls).not.toContain('pause')
    expect(service.list()[0]?.digestPaused).toBeNull()
  })
})
