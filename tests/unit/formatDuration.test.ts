import { describe, it, expect } from 'vitest'
import { formatDuration } from '@shared/time'

describe('formatDuration', () => {
  it('formats milliseconds to seconds only', () => {
    expect(formatDuration(0)).toBe('0s')
    expect(formatDuration(45000)).toBe('45s')
    expect(formatDuration(59000)).toBe('59s')
  })

  it('formats to minutes and seconds', () => {
    expect(formatDuration(60000)).toBe('1m')
    expect(formatDuration(90000)).toBe('1m 30s')
    expect(formatDuration(192000)).toBe('3m 12s')
    expect(formatDuration(3599000)).toBe('59m 59s')
  })

  it('formats to hours, minutes and seconds', () => {
    expect(formatDuration(3600000)).toBe('1h')
    expect(formatDuration(3665000)).toBe('1h 1m 5s')
    expect(formatDuration(7323000)).toBe('2h 2m 3s')
    expect(formatDuration(12391000)).toBe('3h 26m 31s')
  })

  it('omits trailing zero values', () => {
    expect(formatDuration(3600000)).toBe('1h')
    expect(formatDuration(3660000)).toBe('1h 1m')
    expect(formatDuration(3661000)).toBe('1h 1m 1s')
  })
})
