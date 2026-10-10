import { describe, it, expect } from 'vitest'
import { isAbsolute } from 'node:path'
import {
  SETTINGS, mergePayload, pickPayload, settingsDefaults, type SettingContext, type SettingKey,
} from '@shared/settings/schema'
import { DEFAULT_SETTINGS_PAYLOAD } from '@shared/settingsDefaults'
import { DEFAULT_SETTINGS, mergeSettingsPayload } from '../../src/main/settings'

// The "A setting" recipe in CLAUDE.md is one entry in `SETTINGS` plus its control. This file is
// what makes that true: every check below runs over every key in the schema, so a new entry is
// covered without anyone writing a test for it, and an entry that cannot pass (a default its own
// guard rejects, a type the checks cannot build a sample for) fails here rather than in the field.

const ctx: SettingContext = { knownPluginIds: new Set(['known']), isAbsolutePath: isAbsolute }
const keys = Object.keys(SETTINGS) as SettingKey[]
const defOf = (k: SettingKey) => SETTINGS[k] as { guard: (v: unknown) => boolean, default: unknown, range?: { min: number, max: number } }

/** A valid value that differs from the default, so a round trip proves something changed. */
function alternate(key: SettingKey): unknown {
  const { default: d, range } = defOf(key)
  if (typeof d === 'boolean') return !d
  if (range) return d === range.min ? range.max : range.min
  if (key === 'claudeBin') return '/opt/claude'
  if (key === 'proofingLanguage') return 'fr-FR'
  if (key === 'plugins') return { known: false }
  if (key === 'pluginSettings') return { known: { port: 8080 } }
  throw new Error(`settingsSchema.test.ts cannot build a sample for "${key}": add one to alternate()`)
}

/** Something the setting's own guard rejects. */
function wrong(key: SettingKey): unknown {
  const candidates = ['not-the-type', 42, true, { a: 'b' }, [], null, NaN]
  const found = candidates.find((c) => !defOf(key).guard(c))
  if (found === undefined) throw new Error(`no wrong-typed sample for "${key}"`)
  return found
}

describe('the settings schema', () => {
  it('DEFAULT_SETTINGS_PAYLOAD has exactly the schema keys', () => {
    expect(Object.keys(DEFAULT_SETTINGS_PAYLOAD).sort()).toEqual([...keys].sort())
    expect(DEFAULT_SETTINGS_PAYLOAD).toEqual(settingsDefaults())
  })

  it('AppSettings is the payload plus exactly the main-only fields', () => {
    const extra = Object.keys(DEFAULT_SETTINGS).filter((k) => !keys.includes(k as SettingKey)).sort()
    expect(extra).toEqual(['claudeUsageConsent', 'schemaVersion', 'updateSkippedVersion', 'windowBounds'])
  })

  it.each(keys)('%s: the default satisfies its own guard and constraint', (key) => {
    const def = SETTINGS[key] as unknown as {
      guard: (v: unknown) => boolean, default: unknown, constrain?: (v: unknown, c: SettingContext) => unknown
    }
    expect(def.guard(def.default)).toBe(true)
    // Constraint-less settings are their own constraint, so this holds for every key unconditionally.
    expect(def.constrain?.(def.default, ctx) ?? def.default).toEqual(def.default)
  })

  it.each(keys)('%s: a valid value round-trips through merge', (key) => {
    const value = alternate(key)
    const { merged, rejected } = mergePayload(DEFAULT_SETTINGS_PAYLOAD, { [key]: value }, ctx)
    expect(rejected).toEqual([])
    expect(merged[key]).toEqual(value)
    // ...and touches nothing else.
    for (const other of keys.filter((k) => k !== key)) expect(merged[other]).toEqual(DEFAULT_SETTINGS_PAYLOAD[other])
  })

  it.each(keys)('%s: a wrong-typed value is rejected and leaves the current value', (key) => {
    const current = { ...DEFAULT_SETTINGS_PAYLOAD, [key]: alternate(key) }
    const { merged, rejected } = mergePayload(current, { [key]: wrong(key) }, ctx)
    expect(rejected).toEqual([key])
    expect(merged).toEqual(current)
  })

  it.each(keys)('%s: missing or undefined means unchanged', (key) => {
    const current = { ...DEFAULT_SETTINGS_PAYLOAD, [key]: alternate(key) }
    expect(mergePayload(current, {}, ctx)).toEqual({ merged: current, rejected: [] })
    expect(mergePayload(current, { [key]: undefined }, ctx)).toEqual({ merged: current, rejected: [] })
  })

  it.each(keys.filter((k) => defOf(k).range))('%s: an out-of-range number is clamped into its range', (key) => {
    const { min, max } = defOf(key).range!
    expect(mergePayload(DEFAULT_SETTINGS_PAYLOAD, { [key]: min - 1000 }, ctx).merged[key]).toBe(min)
    expect(mergePayload(DEFAULT_SETTINGS_PAYLOAD, { [key]: max + 1000 }, ctx).merged[key]).toBe(max)
    expect(mergePayload(DEFAULT_SETTINGS_PAYLOAD, { [key]: min + 0.4 }, ctx).merged[key]).toBe(min)
  })

  it('a key the schema has never heard of is ignored', () => {
    const { merged, rejected } = mergePayload(DEFAULT_SETTINGS_PAYLOAD, { fromTheFuture: true } as never, ctx)
    expect(merged).toEqual(DEFAULT_SETTINGS_PAYLOAD)
    expect(rejected).toEqual([])
  })

  it('pickPayload drops everything that is not a schema key', () => {
    expect(pickPayload(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS_PAYLOAD)
  })

  it('mergeSettingsPayload keeps the main-only fields and rejects a wrong-typed boolean', () => {
    const current = { ...DEFAULT_SETTINGS, searchChatContent: true, updateSkippedVersion: '1.9.0' }
    const merged = mergeSettingsPayload(current, { searchChatContent: 'false' as never, autoImportAll: true }, new Set())
    expect(merged.searchChatContent).toBe(true)
    expect(merged.autoImportAll).toBe(true)
    expect(merged.updateSkippedVersion).toBe('1.9.0')
  })

  it('a plugins map with a non-boolean value is rejected whole, not half-applied', () => {
    const current = { ...DEFAULT_SETTINGS, plugins: { a: true } }
    expect(mergeSettingsPayload(current, { plugins: { a: false, b: 'yes' } as never }, new Set()).plugins).toEqual({ a: true })
  })

  it('claudeBin: null is a real value, a relative path is rejected', () => {
    const current = { ...DEFAULT_SETTINGS_PAYLOAD, claudeBin: '/opt/claude' }
    expect(mergePayload(current, { claudeBin: null }, ctx).merged.claudeBin).toBeNull()
    expect(mergePayload(current, { claudeBin: 'claude' }, ctx).rejected).toEqual(['claudeBin'])
  })
})
