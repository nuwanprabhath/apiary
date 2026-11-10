import { describe, expect, it, vi } from 'vitest'
import { IPC } from '@shared/ipc/contract'
import { resyncPtyTo } from '../../src/main/app/remoteContainer'

vi.mock('electron', () => ({ BrowserWindow: {}, webContents: {} }))

describe('resyncPtyTo', () => {
  it('sends one event that resets the terminal and then draws the rendered screen', async () => {
    const send = vi.fn()
    resyncPtyTo({ snapshot: () => Promise.resolve({ data: 'screen' }) }, 'pty-a', { send })
    await vi.waitFor(() => { expect(send).toHaveBeenCalledTimes(1) })
    expect(send).toHaveBeenCalledWith(IPC.ptyData.channel, 'pty-a', '\u001bcscreen')
  })

  it('skips a pty that is gone', async () => {
    const send = vi.fn()
    const snapshot = vi.fn(() => Promise.resolve(null))
    resyncPtyTo({ snapshot }, 'pty-a', { send })
    await vi.waitFor(() => { expect(snapshot).toHaveBeenCalled() })
    await Promise.resolve()
    expect(send).not.toHaveBeenCalled()
  })
})
