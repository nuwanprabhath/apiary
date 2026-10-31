import { describe, expect, it } from 'vitest'
import { SETTINGS, mergePayload, settingsDefaults } from '@shared/settings/schema'
import type { ResidentConfig } from '@shared/domain/residents'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSettingsStore } from '../../../src/main/settings'

const CTX = { knownPluginIds: new Set<string>(), isAbsolutePath: (p: string) => p.startsWith('/') }

const regent = (over: Partial<ResidentConfig> = {}): ResidentConfig => ({
  id: 'regent', kind: 'regent', name: 'Regent', enabled: false, model: 'sonnet', digestModel: 'haiku',
  schedule: { days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' }, pauseAboveUsagePercent: 70,
  permissionMode: 'auto', digestLookback: null, options: {}, cycleEveryMinutes: null, ...over,
})

/** A Regent as 1.49.0 saved it, before the permission mode, the lookback, the options and the cycle interval. */
const savedBeforeFields = (): Record<string, unknown> => {
  const { permissionMode: _p, digestLookback: _d, options: _o, cycleEveryMinutes: _c, ...old } = regent()
  return old
}

describe('cycleEveryMinutes', () => {
  it('keeps 5, 10, 15, 30 or 60 and null; anything else is the kind\'s default (null)', () => {
    for (const minutes of [5, 10, 15, 30, 60]) expect(apply([regent({ cycleEveryMinutes: minutes })])[0].cycleEveryMinutes).toBe(minutes)
    for (const bad of [0, 7, 45, -15, '15', 15.5]) {
      expect(apply([{ ...regent(), cycleEveryMinutes: bad }])[0].cycleEveryMinutes).toBeNull()
    }
  })

  it('is filled with null for a config saved before it existed', () => {
    expect(apply([savedBeforeFields()])[0].cycleEveryMinutes).toBeNull()
  })
})

describe('a resident saved before the new fields', () => {
  it('passes the guard and gets the defaults filled', () => {
    expect(SETTINGS.residents.guard([savedBeforeFields()])).toBe(true)
    expect(apply([savedBeforeFields()])).toEqual([regent()])
  })

  it('survives a load of settings.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'apiary-residents-'))
    const file = join(dir, 'settings.json')
    writeFileSync(file, JSON.stringify({ schemaVersion: 1, residents: [savedBeforeFields()] }))
    expect(createSettingsStore(file).load().residents).toEqual([regent()])
    rmSync(dir, { recursive: true, force: true })
  })

  it('keeps a valid lookback, mode and options; drops an invalid one to its default', () => {
    const kept = apply([regent({ digestLookback: { amount: 2, unit: 'weeks' }, permissionMode: 'manual', options: { project: 'g/a' } })])[0]
    expect([kept.digestLookback, kept.permissionMode, kept.options]).toEqual([{ amount: 2, unit: 'weeks' }, 'manual', { project: 'g/a' }])
    const bad = { ...regent(), digestLookback: { amount: 0, unit: 'years' }, permissionMode: 'yolo', options: { project: 3, 'bad key': 'x' } }
    expect(apply([bad])[0]).toEqual(regent())
  })
})

const apply = (value: unknown): ResidentConfig[] => {
  const { merged } = mergePayload(settingsDefaults(), { residents: value as ResidentConfig[] }, CTX)
  return merged.residents
}

describe('the residents setting', () => {
  it('defaults to none', () => {
    expect(settingsDefaults().residents).toEqual([])
  })

  it('keeps a valid config as it is', () => {
    expect(apply([regent()])).toEqual([regent()])
  })

  it('the guard refuses what is not a list of configs', () => {
    expect(SETTINGS.residents.guard('regent')).toBe(false)
    expect(SETTINGS.residents.guard([{ id: 'regent' }])).toBe(false)
    expect(SETTINGS.residents.guard([{ ...regent(), enabled: 'yes' }])).toBe(false)
    expect(SETTINGS.residents.guard([regent()])).toBe(true)
  })

  it('trims the name and cuts it to 40 characters; an empty name leaves the setting as it was', () => {
    expect(apply([regent({ name: '  Chief  ' })])[0].name).toBe('Chief')
    expect(apply([regent({ name: 'x'.repeat(60) })])[0].name).toHaveLength(40)
    expect(apply([regent({ name: '   ' })])).toEqual([])
  })

  it('days become unique integers 0 to 6, in order', () => {
    expect(apply([regent({ schedule: { days: [5, 1, 1, 7, -1, 2.5, 0], start: '09:00', end: '18:00' } })])[0].schedule.days).toEqual([0, 1, 5])
  })

  it('a time that is not HH:MM rejects the value', () => {
    expect(apply([regent({ schedule: { days: [1], start: '9:00', end: '18:00' } })])).toEqual([])
    expect(apply([regent({ schedule: { days: [1], start: '09:00', end: '24:00' } })])).toEqual([])
  })

  it('the usage pause is clamped to 0..100', () => {
    expect(apply([regent({ pauseAboveUsagePercent: 140 })])[0].pauseAboveUsagePercent).toBe(100)
    expect(apply([regent({ pauseAboveUsagePercent: -3 })])[0].pauseAboveUsagePercent).toBe(0)
  })

  it('drops an unknown kind and a repeated id, keeping the rest', () => {
    const gitlab = { ...regent({ id: 'mr' }), kind: 'gitlab' }
    expect(apply([regent(), gitlab, regent({ name: 'Second' })]).map((c) => [c.id, c.name])).toEqual([['regent', 'Regent']])
  })

  it('drops an id that is not a folder-safe slug', () => {
    expect(apply([regent({ id: '../escape' }), regent({ id: 'regent-2' })]).map((c) => c.id)).toEqual(['regent-2'])
  })

  it('refuses a model a shell could read as more than one word', () => {
    expect(apply([regent({ model: 'sonnet; rm -rf' })])).toEqual([])
    expect(apply([regent({ model: 'claude-opus-5-5[1m]' })])[0].model).toBe('claude-opus-5-5[1m]')
  })
})
