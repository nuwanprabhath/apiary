import { describe, it, expect } from 'vitest'
import { pickWindowAt, type WindowRect } from '../../src/main/windowAtPoint'

const win = (id: number, over: Partial<WindowRect> = {}): WindowRect => ({
  id, x: 0, y: 0, width: 100, height: 100, visible: true, ...over,
})

describe('pickWindowAt', () => {
  it('finds the window the pointer was released over', () => {
    const windows = [win(1), win(2, { x: 200 })]
    expect(pickWindowAt(windows, [1, 2], { x: 210, y: 10 })).toBe(2)
  })

  it('answers with nothing when the release was over no window at all', () => {
    // Which is the other half of the gesture: dropped on the desktop means a new window.
    expect(pickWindowAt([win(1)], [1], { x: 500, y: 500 })).toBeNull()
  })

  it('prefers the most recently focused of two overlapping windows', () => {
    // Electron exposes no z-order, and the window being dragged from is on top of what it covers —
    // so a release over the overlap belongs to it, not to the window underneath.
    const windows = [win(1), win(2)]
    expect(pickWindowAt(windows, [2, 1], { x: 50, y: 50 })).toBe(2)
    expect(pickWindowAt(windows, [1, 2], { x: 50, y: 50 })).toBe(1)
  })

  it('never picks a hidden window', () => {
    expect(pickWindowAt([win(1, { visible: false })], [1], { x: 50, y: 50 })).toBeNull()
  })

  it('still picks a window that has never been focused, when it is the only one there', () => {
    expect(pickWindowAt([win(7)], [], { x: 50, y: 50 })).toBe(7)
  })

  it('counts the edges as inside, so a drop on the frame is not lost', () => {
    expect(pickWindowAt([win(1)], [1], { x: 100, y: 100 })).toBe(1)
  })
})
