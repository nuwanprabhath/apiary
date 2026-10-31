import { describe, expect, it } from 'vitest'
import { dutyStatusText } from '@shared/residentSchedule'

const weekdays = { days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' }

describe('dutyStatusText', () => {
  it('says on duty inside the window', () => {
    expect(dutyStatusText(weekdays, new Date(2026, 9, 28, 10, 0))).toBe('On duty now')
  })

  it('names the next start across a weekend', () => {
    // Saturday 31 October 2026
    expect(dutyStatusText(weekdays, new Date(2026, 9, 31, 12, 0))).toBe('Off duty — next on Mon 09:00')
  })

  it('has no next start when no day is chosen', () => {
    expect(dutyStatusText({ ...weekdays, days: [] }, new Date(2026, 9, 28, 10, 0))).toBe('Off duty')
  })
})
