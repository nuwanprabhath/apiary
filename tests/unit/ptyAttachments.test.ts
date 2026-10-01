import { describe, it, expect } from 'vitest'
import { PtyAttachments, type PtyTarget } from '../../src/main/windows/ptyAttachments'
import { PtyDataCoalescer } from '../../src/main/terminals/ptyDataCoalescer'

interface FakeWin extends PtyTarget { got: unknown[][]; destroyed: boolean }

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
  const at = new PtyAttachments((id) => wins.get(id) ?? null)
  return { at, open }
}

describe('PtyAttachments (MAIN-26 step 2)', () => {
  it('a window without the pty attached receives no data', () => {
    const { at, open } = harness()
    const a = open(1)
    const b = open(2)
    at.attach(1, 'p1')
    for (let i = 0; i < 100; i++) at.sendTo('p1', 'data', 'p1', 'x')
    expect(a.got).toHaveLength(100)
    expect(b.got).toHaveLength(0)
  })

  it('several windows over the same pty all receive it', () => {
    const { at, open } = harness()
    const a = open(1)
    const b = open(2)
    at.attach(1, 'p1')
    at.attach(2, 'p1')
    at.sendTo('p1', 'data', 'p1', 'x')
    expect([a.got.length, b.got.length]).toEqual([1, 1])
  })

  it('a tab moved to another window: the new one attaches, the old one detaches', () => {
    const { at, open } = harness()
    const a = open(1)
    const b = open(2)
    at.attach(1, 'p1')
    at.attach(2, 'p1')
    at.detach(1, 'p1')
    at.sendTo('p1', 'data', 'p1', 'x')
    expect([a.got.length, b.got.length]).toEqual([0, 1])
  })

  it('rekey: the view re-attaches under the new id, the old id routes nowhere', () => {
    const { at, open } = harness()
    const a = open(1)
    at.attach(1, 'pending')
    at.detach(1, 'pending')
    at.attach(1, 'real')
    at.sendTo('pending', 'data', 'pending', 'x')
    at.sendTo('real', 'data', 'real', 'y')
    expect(a.got).toEqual([['data', 'real', 'y']])
  })

  it('a closed or reloaded window loses all its attachments', () => {
    const { at, open } = harness()
    const a = open(1)
    at.attach(1, 'p1')
    at.attach(1, 'p2')
    at.detachWindow(1)
    at.sendTo('p1', 'data', 'p1', 'x')
    at.sendTo('p2', 'data', 'p2', 'x')
    expect(a.got).toHaveLength(0)
    expect(at.windowsFor('p1')).toEqual([])
  })

  it('a destroyed or unknown window is pruned on send instead of throwing', () => {
    const { at, open } = harness()
    const a = open(1)
    at.attach(1, 'p1')
    at.attach(2, 'p1')
    a.destroyed = true
    at.sendTo('p1', 'data', 'p1', 'x')
    expect(at.windowsFor('p1')).toEqual([])
  })

  it('composes with the coalescer: 50 chunks reach only the attached window, as one message', () => {
    const { at, open } = harness()
    const a = open(1)
    const b = open(2)
    at.attach(1, 'p1')
    let flush = (): void => {}
    const c = new PtyDataCoalescer({
      onFlush: (id, data) => { at.sendTo(id, 'data', id, data) },
      schedule: (cb) => { flush = cb; return { cancel: () => {} } },
    })
    for (let i = 0; i < 50; i++) c.push('p1', 'x')
    flush()
    expect(a.got).toEqual([['data', 'p1', 'x'.repeat(50)]])
    expect(b.got).toHaveLength(0)
  })
})
