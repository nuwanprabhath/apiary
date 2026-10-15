import { describe, it, expect } from 'vitest'
import { minimumWidth, widenedBounds } from '../../src/main/windows/windowWidth'

const SCREEN = { x: 0, y: 25, width: 1440, height: 875 }

describe('the window grows to fit its panes', () => {
  it('widens a window narrower than its panes need, in place while it fits on the screen', () => {
    expect(widenedBounds({ x: 100, y: 40, width: 900, height: 700 }, SCREEN, 1030)).toEqual({ x: 100, y: 40, width: 1030, height: 700 })
  })

  it('moves it left only as far as it must to stay on the screen, and no wider than the screen', () => {
    expect(widenedBounds({ x: 800, y: 40, width: 900, height: 700 }, SCREEN, 1030)).toEqual({ x: 410, y: 40, width: 1030, height: 700 })
    expect(widenedBounds({ x: 0, y: 40, width: 900, height: 700 }, SCREEN, 2000)).toEqual({ x: 0, y: 40, width: 1440, height: 700 })
  })

  it('leaves a window that is wide enough alone', () => {
    expect(widenedBounds({ x: 0, y: 40, width: 1200, height: 700 }, SCREEN, 1030)).toBeNull()
  })

  it('never lowers a window below its own kind\'s minimum', () => {
    expect(minimumWidth(900, 640.2)).toBe(900)
    expect(minimumWidth(520, 640.2)).toBe(641)
  })
})
