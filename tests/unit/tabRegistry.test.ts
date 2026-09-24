import { describe, it, expect, vi } from 'vitest'
import { TabRegistry } from '../../src/main/tabRegistry'

describe('TabRegistry', () => {
  it('lists tabs reported by a window', () => {
    const registry = new TabRegistry()
    registry.report(1, [{ windowNumber: 1, key: 'session-a', view: 'terminal', ptyId: 'pty-1', label: null }])
    expect(registry.list()).toEqual([{ windowNumber: 1, key: 'session-a', view: 'terminal', ptyId: 'pty-1', label: null }])
  })

  it('a later report from the same window replaces its earlier one entirely', () => {
    const registry = new TabRegistry()
    registry.report(1, [{ windowNumber: 1, key: 'a', view: 'terminal', ptyId: 'pty-a', label: null }])
    registry.report(1, [{ windowNumber: 1, key: 'b', view: 'terminal', ptyId: 'pty-b', label: null }])
    expect(registry.list()).toEqual([{ windowNumber: 1, key: 'b', view: 'terminal', ptyId: 'pty-b', label: null }])
  })

  it('keeps other windows separate', () => {
    const registry = new TabRegistry()
    registry.report(1, [{ windowNumber: 1, key: 'a', view: 'terminal', ptyId: 'pty-a', label: null }])
    registry.report(2, [{ windowNumber: 2, key: 'b', view: 'terminal', ptyId: 'pty-b', label: null }])
    expect(registry.list().map((t) => t.key).sort()).toEqual(['a', 'b'])
  })

  it('clears a window entirely when it closes', () => {
    const registry = new TabRegistry()
    registry.report(1, [{ windowNumber: 1, key: 'a', view: 'terminal', ptyId: 'pty-a', label: null }])
    registry.report(2, [{ windowNumber: 2, key: 'b', view: 'terminal', ptyId: 'pty-b', label: null }])
    registry.unregisterWindow(1)
    expect(registry.list()).toEqual([{ windowNumber: 2, key: 'b', view: 'terminal', ptyId: 'pty-b', label: null }])
  })

  it('notifies subscribers on report and on unregister', () => {
    const registry = new TabRegistry()
    const handler = vi.fn()
    registry.onChange(handler)
    registry.report(1, [{ windowNumber: 1, key: 'a', view: 'terminal', ptyId: 'pty-a', label: null }])
    registry.unregisterWindow(1)
    expect(handler).toHaveBeenCalledTimes(2)
  })
})

describe('TabRegistry.handOver', () => {
  it('moves a tab to its new window at once, so it is never in no window at all', () => {
    const registry = new TabRegistry()
    registry.report(1, [
      { windowNumber: 1, key: 'a', view: 'terminal', ptyId: 'a', label: null },
      { windowNumber: 1, key: 'b', view: 'transcript', ptyId: null, label: null },
    ])
    registry.handOver(2, { windowNumber: 2, key: 'a', view: 'terminal', ptyId: 'a', label: null })
    expect(registry.list().map((t) => `${String(t.windowNumber)}:${t.key}`)).toEqual(['1:b', '2:a'])

    // The new window's own report is still what counts once it arrives.
    registry.report(2, [{ windowNumber: 2, key: 'a', view: 'terminal', ptyId: 'a', label: 'x' }])
    expect(registry.list().find((t) => t.key === 'a')?.label).toBe('x')
  })
})
