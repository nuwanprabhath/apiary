import { describe, it, expect, vi } from 'vitest'
import { TabRegistry } from '../../src/main/tabRegistry'

describe('TabRegistry', () => {
  it('lists tabs reported by a window', () => {
    const registry = new TabRegistry()
    registry.report(1, [{ windowNumber: 1, key: 'session-a', view: 'terminal', ptyId: 'pty-1' }])
    expect(registry.list()).toEqual([{ windowNumber: 1, key: 'session-a', view: 'terminal', ptyId: 'pty-1' }])
  })

  it('a later report from the same window replaces its earlier one entirely', () => {
    const registry = new TabRegistry()
    registry.report(1, [{ windowNumber: 1, key: 'a', view: 'terminal', ptyId: 'pty-a' }])
    registry.report(1, [{ windowNumber: 1, key: 'b', view: 'terminal', ptyId: 'pty-b' }])
    expect(registry.list()).toEqual([{ windowNumber: 1, key: 'b', view: 'terminal', ptyId: 'pty-b' }])
  })

  it('keeps other windows separate', () => {
    const registry = new TabRegistry()
    registry.report(1, [{ windowNumber: 1, key: 'a', view: 'terminal', ptyId: 'pty-a' }])
    registry.report(2, [{ windowNumber: 2, key: 'b', view: 'terminal', ptyId: 'pty-b' }])
    expect(registry.list().map((t) => t.key).sort()).toEqual(['a', 'b'])
  })

  it('clears a window entirely when it closes', () => {
    const registry = new TabRegistry()
    registry.report(1, [{ windowNumber: 1, key: 'a', view: 'terminal', ptyId: 'pty-a' }])
    registry.report(2, [{ windowNumber: 2, key: 'b', view: 'terminal', ptyId: 'pty-b' }])
    registry.unregisterWindow(1)
    expect(registry.list()).toEqual([{ windowNumber: 2, key: 'b', view: 'terminal', ptyId: 'pty-b' }])
  })

  it('notifies subscribers on report and on unregister', () => {
    const registry = new TabRegistry()
    const handler = vi.fn()
    registry.onChange(handler)
    registry.report(1, [{ windowNumber: 1, key: 'a', view: 'terminal', ptyId: 'pty-a' }])
    registry.unregisterWindow(1)
    expect(handler).toHaveBeenCalledTimes(2)
  })
})
