import { describe, it, expect, vi } from 'vitest'
import type { Handlers, Listeners } from '../../src/main/ipc/registrar'

/**
 * The registrar's sender check, end to end through `registerAll`: with `electron` mocked, the
 * handler it hands `ipcMain.handle` is called the way Electron would call it, with and without a
 * sender frame. Electron gives `senderFrame` as null for a frame that has been destroyed.
 */
const handlers = new Map<string, (...args: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => { handlers.set(channel, fn) },
    on: () => {},
    removeHandler: () => {},
    removeAllListeners: () => {},
  },
}))
vi.mock('../../src/main/log/logger', () => ({ log: { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} } }))

const { registerAll } = await import('../../src/main/ipc/registrar')
const { UNCHECKED_SENDERS } = await import('../../src/main/ipc/ipcSenderGuard')

const refresh = vi.fn()
/** Just the one channel: the registrar wires whatever keys it is given. */
const onlyRefresh = (): Handlers => {
  const partial: Partial<Handlers> = { refresh }
  return partial as Handlers
}
const REFRESH_CHANNEL = 'apiary:refresh'
const callRefresh = (event: object): unknown => {
  const fn = handlers.get(REFRESH_CHANNEL)
  if (fn === undefined) throw new Error('refresh was not registered')
  return fn(event)
}

describe('registerAll sender check', () => {
  it('rejects a call whose sender frame is gone (null) when the app configured a renderer', async () => {
    refresh.mockClear()
    const dispose = registerAll(onlyRefresh(), {} as Listeners, { devServerOrigin: null })
    await expect(async () => callRefresh({ senderFrame: null })).rejects.toThrow('Rejected: unexpected sender.')
    await expect(async () => callRefresh({})).rejects.toThrow('Rejected: unexpected sender.')
    expect(refresh).not.toHaveBeenCalled()
    dispose()
  })

  it('accepts the renderer page itself', async () => {
    refresh.mockClear()
    const dispose = registerAll(onlyRefresh(), {} as Listeners, { devServerOrigin: null })
    await callRefresh({ senderFrame: { url: 'file:///app/out/renderer/index.html?w=1' } })
    expect(refresh).toHaveBeenCalledTimes(1)
    dispose()
  })

  it('lets a frameless call through only for a harness that opted out of the check', async () => {
    refresh.mockClear()
    const dispose = registerAll(onlyRefresh(), {} as Listeners, UNCHECKED_SENDERS)
    await callRefresh({})
    expect(refresh).toHaveBeenCalledTimes(1)
    dispose()
  })
})
