import { describe, expect, it } from 'vitest'
import { isOnDuty, nextChange } from '@shared/residentSchedule'

// 2026-10-30 is a Friday. Local time throughout, as the schedule is.
const at = (day: number, hh: number, mm = 0): Date => new Date(2026, 9, day, hh, mm)
const WEEKDAYS = { days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' }

describe('isOnDuty', () => {
  it('a weekday 09-18 is on inside the hours and off outside them', () => {
    expect(isOnDuty(WEEKDAYS, at(30, 12))).toBe(true)
    expect(isOnDuty(WEEKDAYS, at(30, 8, 59))).toBe(false)
    expect(isOnDuty(WEEKDAYS, at(30, 19))).toBe(false)
    expect(isOnDuty(WEEKDAYS, at(31, 12))).toBe(false)
  })

  it('the start is on and the end is off', () => {
    expect(isOnDuty(WEEKDAYS, at(30, 9))).toBe(true)
    expect(isOnDuty(WEEKDAYS, at(30, 17, 59))).toBe(true)
    expect(isOnDuty(WEEKDAYS, at(30, 18))).toBe(false)
  })

  it('an overnight window on Friday runs into Saturday morning, keyed to Friday', () => {
    const night = { days: [5], start: '22:00', end: '02:00' }
    expect(isOnDuty(night, at(30, 21, 59))).toBe(false)
    expect(isOnDuty(night, at(30, 23))).toBe(true)
    expect(isOnDuty(night, at(31, 1, 59))).toBe(true)
    expect(isOnDuty(night, at(31, 2))).toBe(false)
    // Saturday night is not on the list.
    expect(isOnDuty(night, at(31, 23))).toBe(false)
    // Friday's early hours belong to Thursday's window, which is not on the list.
    expect(isOnDuty(night, at(30, 1))).toBe(false)
  })

  it('no days is never on duty', () => {
    expect(isOnDuty({ days: [], start: '00:00', end: '00:00' }, at(30, 12))).toBe(false)
  })
})

describe('nextChange', () => {
  it('from Friday afternoon is Friday 18:00, then Monday 09:00 across the weekend', () => {
    expect(nextChange(WEEKDAYS, at(30, 12))).toEqual(at(30, 18))
    expect(nextChange(WEEKDAYS, at(30, 18))).toEqual(new Date(2026, 10, 2, 9, 0))
    expect(nextChange(WEEKDAYS, at(31, 12))).toEqual(new Date(2026, 10, 2, 9, 0))
  })

  it('an overnight window changes at its start and at its end the next morning', () => {
    const night = { days: [5], start: '22:00', end: '02:00' }
    expect(nextChange(night, at(30, 12))).toEqual(at(30, 22))
    expect(nextChange(night, at(30, 23))).toEqual(at(31, 2))
  })

  it('is null for a schedule that never changes', () => {
    expect(nextChange({ days: [], start: '09:00', end: '18:00' }, at(30, 12))).toBeNull()
    expect(nextChange({ days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '00:00' }, at(30, 12))).toBeNull()
  })
})
