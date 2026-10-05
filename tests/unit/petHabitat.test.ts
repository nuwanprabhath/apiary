import { describe, it, expect } from 'vitest'
import { placeToPoint, nearestPlace, normalisePlace, walkDistance, habitatLengths, RAIL_TOP_RESERVE, type Habitat } from '@shared/pets/habitat'

// A window 1000 wide: a 40px rail from y=40 to y=740, and the bar's free stretch below it.
const withRail: Habitat = { rail: { x: 0, y: 40, width: 40, height: 700 }, bar: { x: 0, y: 750, width: 800, height: 24 } }
const noRail: Habitat = { rail: null, bar: withRail.bar }
const size = 28

describe('pet habitat', () => {
  it('puts feet on the bar\'s floor, inside its ends, and up the middle of the rail below its button', () => {
    expect(placeToPoint(withRail, { region: 'bar', at: 0 }, size)).toEqual({ x: 16, y: 772 })
    expect(placeToPoint(withRail, { region: 'bar', at: 1 }, size)).toEqual({ x: 784, y: 772 })
    expect(placeToPoint(withRail, { region: 'rail', at: 0 }, size)).toEqual({ x: 20, y: 738 })
    expect(placeToPoint(withRail, { region: 'rail', at: 1 }, size)).toEqual({ x: 20, y: 40 + RAIL_TOP_RESERVE })
  })

  it('clamps a place outside 0..1, and draws a rail place on the bar when there is no rail', () => {
    expect(placeToPoint(withRail, { region: 'bar', at: 5 }, size)).toEqual({ x: 784, y: 772 })
    expect(placeToPoint(noRail, { region: 'rail', at: 0.5 }, size).y).toBe(772)
  })

  it('lands a dropped pet on whichever edge is nearer', () => {
    expect(nearestPlace(withRail, { x: 400, y: 700 }, size)).toEqual({ region: 'bar', at: 0.5 })
    expect(nearestPlace(withRail, { x: 30, y: 411 }, size)).toEqual({ region: 'rail', at: 0.5 })
    // Far above the rail's top, it still lands on the rail's highest place.
    expect(nearestPlace(withRail, { x: 10, y: 0 }, size)).toEqual({ region: 'rail', at: 1 })
    expect(nearestPlace(noRail, { x: 30, y: 389 }, size).region).toBe('bar')
  })

  it('gives a pet with no place a spot on the bar, and sends a pet off a vanished rail to the corner', () => {
    expect(normalisePlace(withRail, null, 0.3)).toEqual({ region: 'bar', at: 0.3 })
    expect(normalisePlace(noRail, { region: 'rail', at: 0.8 }, 0.3)).toEqual({ region: 'bar', at: 0 })
    expect(normalisePlace(withRail, { region: 'rail', at: 0.8 }, 0.3)).toEqual({ region: 'rail', at: 0.8 })
  })

  it('measures walks through the corner', () => {
    const corner = { region: 'bar' as const, at: 0 }
    const end = { region: 'bar' as const, at: 1 }
    expect(walkDistance(withRail, corner, end, size)).toBe(768)
    const foot = { region: 'rail' as const, at: 0 }
    const hop = Math.hypot(20 - 16, 738 - 772)
    expect(walkDistance(withRail, foot, end, size)).toBeCloseTo(768 + hop)
    expect(habitatLengths(withRail, size)).toEqual({ rail: 738 - 84, bar: 768 })
    expect(habitatLengths(noRail, size).rail).toBe(0)
  })
})
