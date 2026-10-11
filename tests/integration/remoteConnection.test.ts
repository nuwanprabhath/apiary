import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RemoteConnection } from '../../src/main/remote/remoteConnection'
import { RemoteServer } from '../../src/main/remote/remoteServer'
import { VirtualContentsRegistry } from '../../src/main/remote/virtualContents'
import { createDispatcher, type Handlers } from '../../src/main/ipc/registrar'

vi.mock('electron', () => ({
  ipcMain: { handle: () => {}, on: () => {}, removeHandler: () => {}, removeAllListeners: () => {} },
  BrowserWindow: { getAllWindows: () => [] },
}))

const VERSION = '1.36.0'

describe('RemoteConnection against a real RemoteServer', () => {
  let home: string
  let server: RemoteServer
  let connections: RemoteConnection[]
  let release: (() => void) | null

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'apiary-remote-conn-'))
    connections = []
    release = null
    const handlers: Partial<Handlers> = {
      // Each window is told which window asked, so a test can see where an event went.
      activeTabs: (e) => { e.sender.send('apiary:ping', e.sender.id); return [] },
      checkConflict: () => { throw new Error('boom: it broke') },
      // Never answers until the test says so: a call in flight when the connection drops.
      worktreeCreateOptions: () => new Promise(() => {}),
    }
    server = new RemoteServer({
      homeDir: home, host: 'work-box', appVersion: VERSION, registry: new VirtualContentsRegistry(), layouts: () => [],
    })
    server.attachDispatcher(createDispatcher(handlers, {}))
    await server.start()
  })
  afterEach(async () => {
    release?.()
    for (const c of connections) c.close()
    await server.stop()
    rmSync(home, { recursive: true, force: true })
  })

  async function open(appVersion = VERSION): Promise<RemoteConnection> {
    const c = await RemoteConnection.connect(server.socketPath, { appVersion })
    connections.push(c)
    return c
  }

  it('resolves on welcome with the work machine\'s name', async () => {
    const c = await open()
    expect(c.host).toBe('work-box')
  })

  it("rejects with the server's message when it refuses the hello", async () => {
    await expect(open('9.9.9')).rejects.toThrow('work-box runs Apiary 1.36.0; this machine runs 9.9.9')
  })

  it('rejects "Could not reach Apiary" when there is no socket', async () => {
    await expect(RemoteConnection.connect(join(home, 'nothing.sock'), { appVersion: VERSION, host: 'far-box' }))
      .rejects.toThrow('Could not reach Apiary on far-box')
  })

  it("resolves an invoke with the handler's value and rejects with its message on failure", async () => {
    const c = await open()
    c.openWindow(1)
    await expect(c.invoke(1, 'activeTabs', [])).resolves.toEqual([])
    await expect(c.invoke(1, 'checkConflict', ['s'])).rejects.toThrow('boom: it broke')
  })

  it('rejects every pending invoke, and tells onClosed, when the socket closes', async () => {
    const c = await open()
    const closed = vi.fn()
    c.onClosed(closed)
    c.openWindow(1)
    const outcome = c.invoke(1, 'worktreeCreateOptions', ['/x']).then(() => null, (error: Error) => error.message)
    await server.stop()
    expect(await outcome).toBe('Disconnected from work-box')
    expect(closed).toHaveBeenCalledWith('Disconnected from work-box')
    await expect(c.invoke(1, 'activeTabs', [])).rejects.toThrow('Disconnected from work-box')
  })

  it('delivers an event to the window it is for and no other', async () => {
    const c = await open()
    const heard: { w: number; channel: string; args: unknown[] }[] = []
    c.onEvent((w, channel, args) => { heard.push({ w, channel, args }) })
    c.openWindow(1)
    c.openWindow(2)
    await c.invoke(2, 'activeTabs', [])
    await vi.waitFor(() => { expect(heard).toHaveLength(1) })
    expect(heard[0].w).toBe(2)
    expect(heard[0].channel).toBe('apiary:ping')
    c.closeWindow(2)
    await c.invoke(1, 'activeTabs', [])
    await vi.waitFor(() => { expect(heard).toHaveLength(2) })
    expect(heard[1].w).toBe(1)
  })

  it("lists the work machine's window layouts", async () => {
    const c = await open()
    await expect(c.layouts()).resolves.toEqual([])
  })
})
