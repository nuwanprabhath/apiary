import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { limitResetInTranscript, parseLimitReset } from '../../../src/main/schedule/limitReset'

// Lines Claude Code wrote into real session files (the request ids cut).
const SESSION_NOON = "You've hit your session limit · resets 12pm (Australia/Adelaide)"
const FIVE_HOUR = "You've hit your 5-hour limit · resets 3:40am (Australia/Adelaide) (error type rate_limit, HTTP 429, request id req_01"
const WEEKLY_DATED = "You've hit your weekly limit · resets Oct 29 at 2:30am (Australia/Adelaide)"
const NEXT_DAY = "You've hit your session limit · resets 12:30am (Australia/Adelaide)"

const iso = (at: number | null): string => new Date(at ?? 0).toISOString()

describe('parseLimitReset', () => {
  it("reads a time later the same day in the line's zone", () => {
    // 09:19 on Oct 29 in Adelaide (UTC+10:30, daylight time); resets at 12:00 there.
    expect(iso(parseLimitReset(SESSION_NOON, Date.parse('2026-10-28T22:49:00Z')))).toBe('2026-10-29T01:30:00.000Z')
  })

  it('rolls over to the next day when the time has passed', () => {
    expect(iso(parseLimitReset(NEXT_DAY, Date.parse('2026-11-10T11:30:00Z')))).toBe('2026-11-10T14:00:00.000Z')
  })

  it('reads minutes, and ignores the error suffix', () => {
    expect(iso(parseLimitReset(FIVE_HOUR, Date.parse('2026-11-01T14:00:00Z')))).toBe('2026-11-01T17:10:00.000Z')
  })

  it('reads a dated reset', () => {
    expect(iso(parseLimitReset(WEEKLY_DATED, Date.parse('2026-10-25T00:00:00Z')))).toBe('2026-10-28T16:00:00.000Z')
  })

  it('reads a zone across its daylight-saving change (Adelaide is UTC+9:30 in winter)', () => {
    expect(iso(parseLimitReset(SESSION_NOON, Date.parse('2026-06-01T00:00:00Z')))).toBe('2026-06-01T02:30:00.000Z')
  })

  it('is null for anything else', () => {
    expect(parseLimitReset('API Error: 500', Date.now())).toBeNull()
    expect(parseLimitReset('the limit resets soon', Date.now())).toBeNull()
  })
})

describe('limitResetInTranscript', () => {
  it('finds the last limit line Claude Code wrote into the session file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'limit-'))
    const file = join(dir, 's.jsonl')
    const synthetic = (text: string, timestamp: string): string => JSON.stringify({
      type: 'assistant', timestamp, message: { model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text }] },
    })
    writeFileSync(file, [
      JSON.stringify({ type: 'user', timestamp: '2026-10-28T22:00:00Z', message: { role: 'user', content: 'hit your limit please' } }),
      synthetic(NEXT_DAY, '2026-10-28T10:00:00Z'),
      synthetic(SESSION_NOON, '2026-10-28T22:49:00Z'),
      '',
    ].join('\n'))
    expect(iso(limitResetInTranscript(file))).toBe('2026-10-29T01:30:00.000Z')
    expect(limitResetInTranscript(join(dir, 'missing.jsonl'))).toBeNull()
  })
})
