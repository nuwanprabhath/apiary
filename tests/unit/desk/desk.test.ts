import { describe, expect, it, vi } from 'vitest'
import { startDesk, type DeskParts } from '../../../src/main/desk/desk'

describe('the desk', () => {
  it('starts the Slack poller, and its disposer stops it', async () => {
    const stopBridge = vi.fn(async () => {})
    const bridge = { start: vi.fn(() => stopBridge), handle: vi.fn(() => () => {}) }
    const driver = { onEvent: () => () => {} }
    const residents = { onPermissions: () => () => {} }
    const parts = { bridge, driver, residents } as unknown as DeskParts
    const stop = startDesk(parts)
    expect(bridge.start).toHaveBeenCalledOnce()
    await stop()
    expect(stopBridge).toHaveBeenCalledOnce()
  })
})
