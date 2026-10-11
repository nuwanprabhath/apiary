import { describe, it, expect, expectTypeOf, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import { VIRTUAL_ID_BASE, VirtualContentsRegistry } from '../../src/main/remote/virtualContents'
import { scopeOf } from '../../src/main/remote/scopes'
import type { ServerMessage } from '../../src/main/remote/protocol'
import type { Handlers, Listeners } from '../../src/main/ipc/registrar'
import type { RemoteEvent } from '../../src/main/windows/caller'

describe('VirtualContents', () => {
  it('gets ids far above Electron\'s, each different', () => {
    const registry = new VirtualContentsRegistry()
    const a = registry.create(1, () => {})
    const b = registry.create(2, () => {})
    expect(a.id).toBeGreaterThanOrEqual(VIRTUAL_ID_BASE)
    expect(b.id).toBe(a.id + 1)
    expect(registry.get(a.id)).toBe(a)
    expect(registry.list()).toEqual([a, b])
  })

  it('send writes an event frame for its own window', () => {
    const registry = new VirtualContentsRegistry()
    const written: ServerMessage[] = []
    const a = registry.create(7, (m) => written.push(m))
    registry.create(8, () => { throw new Error('the other window must not hear this') })
    a.send('apiary:pty-data', 'p1', 'hello')
    expect(written).toEqual([{ t: 'event', w: 7, channel: 'apiary:pty-data', args: ['p1', 'hello'] }])
  })

  it('destroy emits destroyed once, turns isDestroyed true and forgets the window', () => {
    const registry = new VirtualContentsRegistry()
    const written: ServerMessage[] = []
    const a = registry.create(1, (m) => written.push(m))
    const gone = vi.fn()
    a.once('destroyed', gone)
    expect(a.isDestroyed()).toBe(false)
    a.destroy()
    a.destroy()
    expect(gone).toHaveBeenCalledTimes(1)
    expect(a.isDestroyed()).toBe(true)
    expect(registry.get(a.id)).toBeNull()
    a.send('apiary:pty-data', 'p1', 'late')
    expect(written).toEqual([])
  })
})

describe('handler events by scope', () => {
  it('a remote-scoped handler gets a Caller, never a window; a local one keeps the Electron event', () => {
    expectTypeOf<Parameters<Listeners['ptyAttach']>[0]>().toEqualTypeOf<RemoteEvent>()
    expectTypeOf<Parameters<Handlers['transcript']>[0]>().toEqualTypeOf<RemoteEvent>()
    expectTypeOf<Parameters<Handlers['settingsSet']>[0]>().toEqualTypeOf<IpcMainInvokeEvent>()
    expect([scopeOf('transcript'), scopeOf('settingsSet')]).toEqual(['remote', 'local'])
  })
})
