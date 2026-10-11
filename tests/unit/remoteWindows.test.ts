import { describe, expect, it, vi } from 'vitest'
import { IPC, type IpcKey } from '@shared/ipc/contract'
import { RemoteWindows, type RemoteLink } from '../../src/main/remote/remoteWindows'
import type { ChildProcess } from 'node:child_process'
import { createVsCodeBridge } from '../../src/main/remote/vscodeBridge'
import { UNAVAILABLE_MESSAGE } from '../../src/main/remote/scopes'
import { broadcast, registerBroadcastSkip } from '../../src/main/windows/broadcast'

const fakeWindows: { id: number; sent: string[] }[] = []
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => fakeWindows.map((w) => ({
      isDestroyed: () => false,
      webContents: { id: w.id, send: (channel: string) => { w.sent.push(channel) } },
    })),
  },
}))

class FakeLink implements RemoteLink {
  host = 'work-box'
  isClosed = false
  opened: number[] = []
  closedWindows: number[] = []
  invoked: { w: number; key: IpcKey; args: unknown[] }[] = []
  sent: { w: number; key: IpcKey; args: unknown[] }[] = []
  private events: ((w: number, channel: string, args: unknown[]) => void)[] = []
  private closers: ((reason: string) => void)[] = []

  resolve: RemoteLink['resolve'] = () => Promise.reject(new Error('not resolved'))
  openWindow(w: number): void { this.opened.push(w) }
  closeWindow(w: number): void { this.closedWindows.push(w) }
  invoke(w: number, key: IpcKey, args: unknown[]): Promise<unknown> {
    this.invoked.push({ w, key, args })
    return Promise.resolve('forwarded')
  }

  send(w: number, key: IpcKey, args: unknown[]): void { this.sent.push({ w, key, args }) }
  onEvent(fn: (w: number, channel: string, args: unknown[]) => void): () => void {
    this.events.push(fn)
    return () => { this.events = this.events.filter((e) => e !== fn) }
  }

  onClosed(fn: (reason: string) => void): () => void { this.closers.push(fn); return () => {} }
  emit(w: number, channel: string, args: unknown[]): void { for (const fn of this.events) fn(w, channel, args) }
  disconnect(reason: string): void { this.isClosed = true; for (const fn of this.closers) fn(reason) }
}

function setup(): { windows: RemoteWindows; link: FakeLink; heard: Map<number, unknown[][]> } {
  const heard = new Map<number, unknown[][]>()
  const windows = new RemoteWindows((id) => ({
    isDestroyed: () => false,
    send: (channel: string, ...args: unknown[]) => { heard.set(id, [...(heard.get(id) ?? []), [channel, ...args]]) },
  }))
  return { windows, link: new FakeLink(), heard }
}

describe('RemoteWindows', () => {
  it('leaves an unbound window to the handlers at home', () => {
    const { windows } = setup()
    expect(windows.routeInvoke(7, 'tree', [])).toBeUndefined()
    expect(windows.routeSend(7, 'ptyWrite', ['x', 'y'])).toBe(false)
  })

  it('forwards a remote-scope call to the window on the connection, and leaves a local one at home', async () => {
    const { windows, link } = setup()
    windows.bind(7, link, 3)
    expect(link.opened).toEqual([3])
    await expect(windows.routeInvoke(7, 'tree', [])).resolves.toBe('forwarded')
    expect(link.invoked).toEqual([{ w: 3, key: 'tree', args: [] }])
    expect(windows.routeInvoke(7, 'settingsGet', [])).toBeUndefined()
    expect(windows.routeSend(7, 'ptyDetach', ['p'])).toBe(true)
    expect(link.sent).toEqual([{ w: 3, key: 'ptyDetach', args: ['p'] }])
  })

  it('answers an unavailable channel with its fixed answer, or refuses it', async () => {
    const { windows, link } = setup()
    windows.bind(7, link, 1)
    await expect(windows.routeInvoke(7, 'newSessionInPickedFolder', [])).rejects.toThrow(UNAVAILABLE_MESSAGE)
    expect(link.invoked).toEqual([])
  })

  it('rejects after the connection closed, and tells the listener which windows lost it', async () => {
    const { windows, link } = setup()
    const told = vi.fn()
    windows.onDisconnected(told)
    windows.bind(7, link, 1)
    windows.bind(8, link, 2)
    link.disconnect('Disconnected from work-box')
    expect(told).toHaveBeenCalledWith([7, 8], 'work-box', 'Disconnected from work-box')
    link.invoke = () => Promise.reject(new Error('Disconnected from work-box'))
    await expect(windows.routeInvoke(7, 'tree', [])).rejects.toThrow('Disconnected from work-box')
    expect(windows.routeSend(7, 'ptyWrite', ['a', 'b'])).toBe(true)
    expect(link.sent).toEqual([])
  })

  it('records the attaches it forwarded, minus detaches, and replays them on rebind', () => {
    const { windows, link } = setup()
    windows.bind(7, link, 2)
    windows.routeSend(7, 'ptyAttach', ['p1'])
    windows.routeSend(7, 'ptyAttach', ['p2'])
    windows.routeSend(7, 'chatAttach', ['s1'])
    windows.routeSend(7, 'ptyDetach', ['p1'])
    const next = new FakeLink()
    windows.bind(7, next, 2)
    expect(next.opened).toEqual([2])
    expect(next.sent).toEqual([
      { w: 2, key: 'ptyAttach', args: ['p2'] },
      { w: 2, key: 'chatAttach', args: ['s1'] },
    ])
  })

  it('closes the window on the connection when it is unbound', () => {
    const { windows, link } = setup()
    windows.bind(7, link, 4)
    windows.unbind(7)
    expect(link.closedWindows).toEqual([4])
    expect(windows.routeInvoke(7, 'tree', [])).toBeUndefined()
  })

  it('sends a connection event to the bound window of that number only', () => {
    const { windows, link, heard } = setup()
    windows.bind(7, link, 1)
    windows.bind(8, link, 2)
    link.emit(2, 'apiary:tree-changed', [])
    expect(heard.get(8)).toEqual([['apiary:tree-changed']])
    expect(heard.get(7)).toBeUndefined()
  })
})

describe('broadcast to a window that shows a work machine', () => {
  it("skips home's remote-scope events for it, and still delivers its local ones", () => {
    fakeWindows.length = 0
    fakeWindows.push({ id: 1, sent: [] }, { id: 7, sent: [] })
    const { windows, link } = setup()
    windows.bind(7, link, 1)
    const dispose = registerBroadcastSkip(windows.skipsBroadcast)
    broadcast(IPC.treeChanged)
    broadcast(IPC.toggleSidebar)
    dispose()
    expect(fakeWindows[0].sent).toEqual([IPC.treeChanged.channel, IPC.toggleSidebar.channel])
    expect(fakeWindows[1].sent).toEqual([IPC.toggleSidebar.channel])
  })
})

describe('RemoteWindows: bridged calls (opening VS Code at home over Remote-SSH)', () => {
  const terminal = { kind: 'session', id: 's1' }
  const launching = (codePath: string | null): { launched: { command: string; args: string[] }[]; windows: RemoteWindows; link: FakeLink } => {
    const launched: { command: string; args: string[] }[] = []
    const bridge = createVsCodeBridge({
      vsCodePath: () => codePath,
      spawn: (command, args) => { launched.push({ command, args }); return {} as ChildProcess },
    })
    const windows = new RemoteWindows(() => null, bridge)
    const link = new FakeLink()
    link.resolve = (_w, request) => Promise.resolve(request.what === 'session-folder' ? { path: '/home/dev/proj' } : { path: '/home/dev/proj/a.ts', line: 12 })
    windows.bind(7, link, 3, 'work-box')
    return { launched, windows, link }
  }

  it('resolves through the connection, then launches home\'s VS Code on the ssh alias and path', async () => {
    const { launched, windows, link } = launching('/usr/bin/code')
    const resolve = vi.spyOn(link, 'resolve')
    await windows.routeInvoke(7, 'openInVsCode', [terminal])
    expect(resolve).toHaveBeenCalledWith(3, { what: 'session-folder', terminal })
    expect(link.invoked).toEqual([])
    expect(launched).toEqual([{ command: '/usr/bin/code', args: ['--remote', 'ssh-remote+work-box', '/home/dev/proj'] }])
  })

  it('opens a mentioned file at its line with --goto', async () => {
    const { launched, windows } = launching('/usr/bin/code')
    await windows.routeInvoke(7, 'openMentionedFile', [terminal, 'a.ts:12'])
    expect(launched).toEqual([{ command: '/usr/bin/code', args: ['--remote', 'ssh-remote+work-box', '--goto', '/home/dev/proj/a.ts:12'] }])
  })

  it('rejects when this machine has no VS Code, launching nothing', async () => {
    const { launched, windows } = launching(null)
    await expect(windows.routeInvoke(7, 'openInVsCode', [terminal])).rejects.toThrow('VS Code was not found on this machine')
    expect(launched).toEqual([])
  })

  it('launches nothing when the work machine refuses to resolve', async () => {
    const { launched, windows, link } = launching('/usr/bin/code')
    link.resolve = () => Promise.reject(new Error('That is not a file in this session\'s folder'))
    await expect(windows.routeInvoke(7, 'openMentionedFile', [terminal, '../x'])).rejects.toThrow('not a file')
    expect(launched).toEqual([])
  })

  it('leaves an unbound window\'s bridged call to the handlers at home, and answers vsCodeAvailable there', () => {
    const { windows } = launching('/usr/bin/code')
    expect(windows.routeInvoke(99, 'openInVsCode', [terminal])).toBeUndefined()
    expect(windows.routeInvoke(7, 'vsCodeAvailable', [])).toBeUndefined()
  })
})
