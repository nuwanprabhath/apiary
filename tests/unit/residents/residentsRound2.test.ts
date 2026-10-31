import { describe, expect, it } from 'vitest'
import { lookbackStart, lookbackText } from '@shared/digestLookback'
import { permissionSummary } from '../../../src/main/residents/activity'
import { cycleSkip, expandArgv } from '../../../src/main/residents/quickActions'

const DAY = 24 * 60 * 60 * 1000
const NOW = 100 * 365 * DAY

describe('the digest lookback window', () => {
  it('null reaches the whole history', () => {
    expect(lookbackStart(null, NOW)).toBeNull()
    expect(lookbackText(null)).toBe('all history')
  })

  it('days, weeks and months of 30 days', () => {
    expect(lookbackStart({ amount: 3, unit: 'days' }, NOW)).toBe(NOW - 3 * DAY)
    expect(lookbackStart({ amount: 2, unit: 'weeks' }, NOW)).toBe(NOW - 14 * DAY)
    expect(lookbackStart({ amount: 2, unit: 'months' }, NOW)).toBe(NOW - 60 * DAY)
    expect(lookbackText({ amount: 1, unit: 'months' })).toBe('1 month')
    expect(lookbackText({ amount: 6, unit: 'weeks' })).toBe('6 weeks')
  })
})

describe('a permission request summary', () => {
  it('a Bash call reads "Run: <command>", cut at 120 characters', () => {
    expect(permissionSummary('Bash', { command: 'glab  mr\nlist' })).toBe('Run: glab mr list')
    const long = permissionSummary('Bash', { command: 'x'.repeat(300) })
    expect(long).toHaveLength(120)
    expect(long.endsWith('…')).toBe(true)
  })

  it('an edit names the file, anything else the tool', () => {
    expect(permissionSummary('Edit', { file_path: '/a/b/notes.md' })).toBe('Edit notes.md')
    expect(permissionSummary('Write', { file_path: 'C:\\x\\y.ts' })).toBe('Edit y.ts')
    expect(permissionSummary('WebFetch', { url: 'https://x' })).toBe('WebFetch')
    expect(permissionSummary('Bash', {})).toBe('Bash')
  })
})

describe('quick-action argv placeholders', () => {
  const ctx = { options: { project: 'grp/app', blank: '  ' }, bins: { mra: () => ['python3', '/res/mra'] } }

  it('a bin becomes its argv prefix and an option is filled inside an argument', () => {
    expect(expandArgv(['{bin:mra}', 'desk', '--project={option:project}'], ctx)).toEqual(['python3', '/res/mra', 'desk', '--project=grp/app'])
  })

  it('an option value stays one argument', () => {
    expect(expandArgv(['echo', '{option:project}'], { ...ctx, options: { project: 'a b; rm' } })).toEqual(['echo', 'a b; rm'])
  })

  it('an unknown bin or an empty option is an error naming it', () => {
    expect(() => expandArgv(['{bin:nope}'], ctx)).toThrow('Unknown program: nope')
    expect(() => expandArgv(['x', '{option:blank}'], ctx)).toThrow('"blank"')
    expect(() => expandArgv(['x', '{option:missing}'], ctx)).toThrow('"missing"')
  })
})

describe('the cycle gate', () => {
  const ready = { enabled: true, onDuty: true, busy: false, permissionsWaiting: 0, setupNeeded: null }

  it('goes when on duty, idle, with nothing waiting and set up', () => {
    expect(cycleSkip(ready)).toBeNull()
  })

  it('skips off duty, disabled, busy, with a permission waiting, or with setup needed', () => {
    expect(cycleSkip({ ...ready, onDuty: false })).toBe('off duty')
    expect(cycleSkip({ ...ready, enabled: false })).toBe('off duty')
    expect(cycleSkip({ ...ready, busy: true })).toBe('busy')
    expect(cycleSkip({ ...ready, permissionsWaiting: 1 })).toBe('permission waiting')
    expect(cycleSkip({ ...ready, setupNeeded: 'Set the project' })).toBe('setup needed')
  })
})
