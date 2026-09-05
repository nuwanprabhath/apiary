import { describe, it, expect } from 'vitest'
import { boundsAreOnScreen, type DisplayRect } from '../../src/main/windowBounds'

const primary: DisplayRect = { x: 0, y: 0, width: 1920, height: 1080 }
const external: DisplayRect = { x: 1920, y: 0, width: 1920, height: 1080 }

describe('boundsAreOnScreen', () => {
  it('is on screen when fully inside a single display', () => {
    expect(boundsAreOnScreen({ x: 100, y: 100, width: 800, height: 600 }, [primary])).toBe(true)
  })

  it('is not on screen when fully outside every display (disconnected monitor)', () => {
    // Bounds were saved while an external monitor at x=1920..3840 was connected; it's now gone.
    expect(boundsAreOnScreen({ x: 2000, y: 100, width: 800, height: 600 }, [primary])).toBe(false)
  })

  it('is not on screen when only a corner pixel overlaps (Finding 2 regression)', () => {
    // Window's bottom-right corner (1px) touches the primary display's top-left corner.
    const bounds = { x: -799, y: -599, width: 800, height: 600 }
    expect(boundsAreOnScreen(bounds, [primary])).toBe(false)
  })

  it('is on screen when straddling two displays', () => {
    const bounds = { x: 1800, y: 100, width: 400, height: 600 }
    expect(boundsAreOnScreen(bounds, [primary, external])).toBe(true)
  })

  it('is on screen when legitimately half-offscreen but reachable', () => {
    // Half the window (700px of its 1400 width) hangs off the right edge of the display —
    // a normal, deliberate arrangement with a large, easily reachable title-bar strip.
    const bounds = { x: 1220, y: 100, width: 1400, height: 900 }
    expect(boundsAreOnScreen(bounds, [primary])).toBe(true)
  })

  it('is not on screen when the displays array is empty, without throwing', () => {
    expect(() => boundsAreOnScreen({ x: 0, y: 0, width: 800, height: 600 }, [])).not.toThrow()
    expect(boundsAreOnScreen({ x: 0, y: 0, width: 800, height: 600 }, [])).toBe(false)
  })
})
