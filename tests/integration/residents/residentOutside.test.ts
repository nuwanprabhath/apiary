import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ResidentConfig, ResidentTurn } from '@shared/domain/residents'
import { REGENT_KIND } from '@shared/domain/residents'
import { ResidentService, type ResidentSettings } from '../../../src/main/residents/residentService'

/** A real login shell running tests/fixtures/fake-claude-chat.mjs. */
const FAKE = resolve(__dirname, '../../fixtures/fake-claude-chat.mjs')

let realShell: string | undefined
beforeAll(() => { realShell = process.env.SHELL; process.env.SHELL = '/bin/sh' })
afterAll(() => { if (realShell === undefined) delete process.env.SHELL; else process.env.SHELL = realShell })

const dirs: string[] = []
const services: ResidentService[] = []
afterEach(async () => {
  await Promise.all(services.splice(0).map((s) => s.dispose()))
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

// Saturday: Regent's schedule (weekdays) has it off duty.
const SATURDAY = new Date(2026, 10, 7, 12)
const config: ResidentConfig = {
  id: 'regent', kind: REGENT_KIND, name: 'Regent', enabled: true, model: 'sonnet', digestModel: 'haiku',
  schedule: { days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' }, pauseAboveUsagePercent: 70,
  permissionMode: 'auto', digestLookback: null, options: {}, cycleEveryMinutes: null,
}

describe('a resident driven from outside', () => {
  it('a message from outside wakes an off-duty resident and its answer reaches onTurnEnded', async () => {
    const root = mkdtempSync(join(tmpdir(), 'apiary-resident-outside-'))
    dirs.push(root)
    const settings: ResidentSettings = { get: () => [config], set: () => {}, onChange: () => () => {} }
    const service = new ResidentService({
      settings, root, knowledge: null, digest: null, usagePercent: () => null,
      claudeBin: () => FAKE, launchEnv: () => ({}),
      tools: { session: () => null, openSession: () => {}, openTabs: () => [], focusedWindow: () => null },
      onChanged: () => {}, onMessage: () => {}, version: '0.0.0', now: () => SATURDAY,
    })
    services.push(service)
    const heard: ResidentTurn[] = []
    service.onTurnEnded((e) => heard.push(e))
    service.start()
    expect(service.list()[0]).toMatchObject({ onDuty: false, state: 'asleep' })

    service.sendFrom('regent', { text: '[Slack task 1] hello there', shown: 'hello there', via: 'slack' })
    await expect.poll(() => heard.length, { timeout: 15_000 }).toBe(1)
    expect(heard[0]).toMatchObject({ residentId: 'regent', origin: 'slack' })
    expect(heard[0]?.text).not.toBe('')
    expect(service.history('regent')[0]).toMatchObject({ role: 'user', text: 'hello there', via: 'slack' })
  })
})
