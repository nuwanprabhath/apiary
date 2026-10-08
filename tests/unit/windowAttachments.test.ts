import { describe, it, expect } from 'vitest'
import { WindowAttachments, type SendTarget } from '../../src/main/windows/windowAttachments'
import type { EventSpec } from '@shared/ipc/contract'
import { PtyDataCoalescer } from '../../src/main/terminals/ptyDataCoalescer'

// Local event specs: the point of these tests is routing by attachment, not the contract's channels.
const DATA: EventSpec<[id: string, data: string]> = { kind: 'event', channel: 'data' }
const CHAT: EventSpec<[state: string]> = { kind: 'event', channel: 'chat' }

interface FakeWin extends SendTarget { got: unknown[][]; destroyed: boolean }

function harness() {
  const wins = new Map<number, FakeWin>()
  const open = (id: number): FakeWin => {
    const w: FakeWin = {
      got: [],
      destroyed: false,
      isDestroyed() { return this.destroyed },
      send(...a: unknown[]) { this.got.push(a) },
    }
    wins.set(id, w)
    return w
  }
  const at = new WindowAttachments((id) => wins.get(id) ?? null)
  return { at, open }
}

describe('WindowAttachments (MAIN-26 step 2; ptys and chats)', () => {
  it('a window without the pty attached receives no data', () => {
    const { at, open } = harness()
    const a = open(1)
    const b = open(2)
    at.attach(1, 'p1')
    for (let i = 0; i < 100; i++) at.sendTo('p1', DATA, 'p1', 'x')
    expect(a.got).toHaveLength(100)
    expect(b.got).toHaveLength(0)
  })

  it('several windows over the same pty all receive it', () => {
    const { at, open } = harness()
    const a = open(1)
    const b = open(2)
    at.attach(1, 'p1')
    at.attach(2, 'p1')
    at.sendTo('p1', DATA, 'p1', 'x')
    expect([a.got.length, b.got.length]).toEqual([1, 1])
  })

  it('a tab moved to another window: the new one attaches, the old one detaches', () => {
    const { at, open } = harness()
    const a = open(1)
    const b = open(2)
    at.attach(1, 'p1')
    at.attach(2, 'p1')
    at.detach(1, 'p1')
    at.sendTo('p1', DATA, 'p1', 'x')
    expect([a.got.length, b.got.length]).toEqual([0, 1])
  })

  it('rekey: the view re-attaches under the new id, the old id routes nowhere', () => {
    const { at, open } = harness()
    const a = open(1)
    at.attach(1, 'pending')
    at.detach(1, 'pending')
    at.attach(1, 'real')
    at.sendTo('pending', DATA, 'pending', 'x')
    at.sendTo('real', DATA, 'real', 'y')
    expect(a.got).toEqual([['data', 'real', 'y']])
  })

  it('a closed or reloaded window loses all its attachments', () => {
    const { at, open } = harness()
    const a = open(1)
    at.attach(1, 'p1')
    at.attach(1, 'p2')
    at.detachWindow(1)
    at.sendTo('p1', DATA, 'p1', 'x')
    at.sendTo('p2', DATA, 'p2', 'x')
    expect(a.got).toHaveLength(0)
    expect(at.windowsFor('p1')).toEqual([])
  })

  it('a destroyed or unknown window is pruned on send instead of throwing', () => {
    const { at, open } = harness()
    const a = open(1)
    at.attach(1, 'p1')
    at.attach(2, 'p1')
    a.destroyed = true
    at.sendTo('p1', DATA, 'p1', 'x')
    expect(at.windowsFor('p1')).toEqual([])
  })

  it('sendTo with several keys reaches each attached window once', () => {
    const { at, open } = harness()
    const a = open(1)
    const b = open(2)
    at.attach(1, 'old')
    at.attach(1, 'new')
    at.attach(2, 'new')
    at.sendTo(['old', 'new'], CHAT, 'x')
    expect([a.got.length, b.got.length]).toEqual([1, 1])
  })

  it('detachWindow reports what the window held, and isAttached follows', () => {
    const { at, open } = harness()
    open(1)
    at.attach(1, 'p1')
    at.attach(1, 'p2')
    expect(at.isAttached('p1')).toBe(true)
    expect(at.detachWindow(1).sort()).toEqual(['p1', 'p2'])
    expect(at.isAttached('p1')).toBe(false)
    expect(at.detachWindow(1)).toEqual([])
  })

  it('composes with the coalescer: 50 chunks reach only the attached window, as one message', () => {
    const { at, open } = harness()
    const a = open(1)
    const b = open(2)
    at.attach(1, 'p1')
    let flush = (): void => {}
    const c = new PtyDataCoalescer({
      onFlush: (id, data) => { at.sendTo(id, DATA, id, data) },
      schedule: (cb) => { flush = cb; return { cancel: () => {} } },
    })
    for (let i = 0; i < 50; i++) c.push('p1', 'x')
    flush()
    expect(a.got).toEqual([['data', 'p1', 'x'.repeat(50)]])
    expect(b.got).toHaveLength(0)
  })
})
