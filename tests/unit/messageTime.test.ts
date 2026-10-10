import { describe, it, expect } from 'vitest'
import { firstOfMinuteRun, formatMessageTime } from '@shared/time'

const NOW = new Date(2026, 9, 10, 15, 0).getTime()
const at = (y: number, mo: number, d: number, h: number, mi: number): number => new Date(y, mo, d, h, mi).getTime()

describe('formatMessageTime', () => {
  it('shows only the time for today', () => {
    expect(formatMessageTime(at(2026, 9, 10, 10, 29), NOW, 'en-US')).toMatch(/^10:29\s?AM$/)
  })
  it('adds the day for earlier this year', () => {
    expect(formatMessageTime(at(2026, 9, 9, 10, 29), NOW, 'en-US')).toMatch(/^Oct 9,\s10:29\s?AM$/)
  })
  it('adds the year for an earlier year', () => {
    expect(formatMessageTime(at(2025, 9, 9, 10, 29), NOW, 'en-US')).toMatch(/^Oct 9, 2025,\s10:29\s?AM$/)
  })
  it('uses a 24-hour clock where the locale does', () => {
    expect(formatMessageTime(at(2026, 9, 10, 15, 5), NOW, 'de-DE')).toBe('15:05')
  })
})

describe("firstOfMinuteRun", () => {
  it("keeps only the first time of a minute and skips untimed messages", () => {
    const t = at(2026, 9, 10, 10, 29)
    expect(firstOfMinuteRun([t, t + 20_000, null, t + 60_000, t + 70_000, t])).toEqual([t, null, null, t + 60_000, null, t])
  })
})
