/**
 * UI-10: `ptyBus` replaces one `window.apiary.onPtyData`/`onPtyExit` subscription per mounted
 * `TerminalView` with a single shared one, dispatching by pty id. Tested against the fake bridge
 * directly (not through a rendered `TerminalView`) so what is being proven is the bus's own
 * dispatch and resubscription behaviour, not xterm's.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderApp } from './renderApp'
import { ptyBus } from '../../src/renderer/state/ptyBus'

describe('ptyBus', () => {
  it('dispatches a data chunk only to listeners registered for that pty id', async () => {
    const { fake } = await renderApp()
    const forA = vi.fn()
    const forB = vi.fn()
    ptyBus.onData('pty-a', forA)
    ptyBus.onData('pty-b', forB)

    fake.emit('ptyData', 'pty-a', 'hello')

    expect(forA).toHaveBeenCalledExactlyOnceWith('hello')
    expect(forB).not.toHaveBeenCalled()
  })

  it('one underlying onPtyData subscription serves every listener, regardless of how many are registered', async () => {
    const { fake } = await renderApp()
    const before = fake.callsTo('onPtyData').length

    const offs = Array.from({ length: 5 }, (_, i) => ptyBus.onData(`pty-${i}`, () => {}))

    // Registering five listeners for five different ptys must not open five bridge subscriptions —
    // that is exactly the per-mount listener growth this bus exists to collapse.
    expect(fake.callsTo('onPtyData').length - before).toBeLessThanOrEqual(1)

    offs.forEach((off) => { off() })
  })

  it('stops calling a listener once its unsubscribe function runs', async () => {
    const { fake } = await renderApp()
    const cb = vi.fn()
    const off = ptyBus.onData('pty-a', cb)
    fake.emit('ptyData', 'pty-a', 'first')
    off()
    fake.emit('ptyData', 'pty-a', 'second')

    expect(cb).toHaveBeenCalledExactlyOnceWith('first')
  })

  it('dispatches an exit only to listeners for that pty id', async () => {
    const { fake } = await renderApp()
    const forA = vi.fn()
    const forB = vi.fn()
    ptyBus.onExit('pty-a', forA)
    ptyBus.onExit('pty-b', forB)

    fake.emit('ptyExit', 'pty-a', 0)

    expect(forA).toHaveBeenCalledExactlyOnceWith(0)
    expect(forB).not.toHaveBeenCalled()
  })

  it('re-subscribes to a new window.apiary the next time something subscribes, dropping the old one', async () => {
    const first = await renderApp()
    const cb = vi.fn()
    ptyBus.onData('pty-a', cb)

    // A brand new fake, as every test's renderApp() gives one. Registering a listener for an
    // unrelated id is what notices the swap (see `ensureBound`, mirroring `treeStore.ts`'s own
    // check-on-call approach) — `cb` itself stays registered under `pty-a` throughout, exactly as
    // it would if the component that owns it never re-subscribed.
    const second = await renderApp()
    ptyBus.onData('pty-unrelated', () => {})

    first.fake.emit('ptyData', 'pty-a', 'from the old bridge')
    expect(cb).not.toHaveBeenCalled()

    second.fake.emit('ptyData', 'pty-a', 'from the new bridge')
    expect(cb).toHaveBeenCalledExactlyOnceWith('from the new bridge')
  })
})
