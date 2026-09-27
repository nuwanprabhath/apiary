import { describe, it, expect, vi } from 'vitest'
import { TabMover, type MovableWindow } from '../../src/main/windows/tabMover'
import { CHANNELS } from '@shared/api'

function fakeWindow(id: number, bounds: { x: number; y: number; width: number; height: number }, visible = true): MovableWindow & { sent: unknown[][] } {
  const sent: unknown[][] = []
  return {
    webContents: { id, send: (channel: string, ...args: unknown[]) => { sent.push([channel, ...args]) } },
    isDestroyed: () => false,
    isVisible: () => visible,
    getBounds: () => bounds,
    focus: vi.fn(),
    sent,
  }
}

describe('TabMover', () => {
  it('windowUnder picks the most recently focused window under the point', () => {
    const a = fakeWindow(1, { x: 0, y: 0, width: 100, height: 100 })
    const b = fakeWindow(2, { x: 50, y: 50, width: 100, height: 100 })
    const mover = new TabMover({ getWindows: () => [a, b], pty: { has: () => false } })

    mover.rememberFocus(2)
    mover.rememberFocus(1) // 1 focused last, so it wins the overlap
    const hit = mover.windowUnder({ x: 60, y: 60 })
    expect(hit?.webContents.id).toBe(1)
  })

  it('windowUnder returns null when nothing is under the point', () => {
    const a = fakeWindow(1, { x: 0, y: 0, width: 100, height: 100 })
    const mover = new TabMover({ getWindows: () => [a], pty: { has: () => false } })
    expect(mover.windowUnder({ x: 500, y: 500 })).toBeNull()
  })

  it('announceClaimed sends tabClaimed to every window except the keeper', () => {
    const a = fakeWindow(1, { x: 0, y: 0, width: 10, height: 10 })
    const b = fakeWindow(2, { x: 0, y: 0, width: 10, height: 10 })
    const mover = new TabMover({ getWindows: () => [a, b], pty: { has: () => false } })

    mover.announceClaimed('shell:s1:1', 2)
    expect(a.sent).toEqual([[CHANNELS.tabClaimed, 'shell:s1:1']])
    expect(b.sent).toEqual([])
  })

  it('handOver does nothing without a target window or a registry', () => {
    const handOver = vi.fn()
    const mover = new TabMover({
      getWindows: () => [],
      pty: { has: () => false },
      tabRegistry: { handOver } as never,
    })
    mover.handOver({ key: 'k', view: 'terminal' } as never, null)
    expect(handOver).not.toHaveBeenCalled()
  })

  it('handOver files the tab under the target window, deriving ptyId from a live pty when absent', () => {
    const handOver = vi.fn()
    const mover = new TabMover({
      getWindows: () => [],
      pty: { has: (key: string) => key === 'k' },
      tabRegistry: { handOver } as never,
    })
    mover.handOver({ key: 'k', view: 'terminal', ptyId: null } as never, 3)
    expect(handOver).toHaveBeenCalledWith(3, {
      windowNumber: 3, key: 'k', view: 'terminal', ptyId: 'k', label: null,
    })
  })
})
