import { describe, it, expect } from 'vitest'
import { residentSizesFor } from '../../src/renderer/state/residentSizes'

const STATUS_BAR_MAX = 64

describe('residentSizesFor', () => {
  it.each([
    { px: 44, orb: 32, bee: 24, pot: 26, badge: 36 },
    { px: 52, orb: 38, bee: 28, pot: 30, badge: 42 },
    { px: 58, orb: 44, bee: 34, pot: 36, badge: 48 },
    { px: 64, orb: 50, bee: 38, pot: 40, badge: 54 },
  ])('a $px px bar: orb $orb, bee $bee, pot $pot, badge $badge', ({ px, ...sizes }) => {
    expect(residentSizesFor(px)).toEqual(sizes)
  })

  it('every size from 44 to the tallest bar is an even integer, and the badge fits the bar', () => {
    for (let px = 44; px <= STATUS_BAR_MAX; px += 2) {
      const s = residentSizesFor(px)
      for (const v of Object.values(s)) expect(Number.isInteger(v) && v % 2 === 0, `${String(px)}: ${String(v)}`).toBe(true)
      expect(s.badge).toBeLessThanOrEqual(px)
    }
  })
})
