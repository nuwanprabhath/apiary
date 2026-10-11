import { describe, it, expect } from 'vitest'
import { encodeFrame, encodeHandshakeFrame, FrameDecoder, MAX_FRAME_BYTES } from '../../src/main/remote/frames'
import { CHANNEL_SCOPES, scopeOf } from '../../src/main/remote/scopes'
import { contractHash } from '../../src/main/remote/protocol'
import { IPC } from '@shared/ipc/contract'

describe('remote frames', () => {
  it('round-trips values as structured clone does: undefined, Date, Map and typed arrays survive', () => {
    const message = { t: 'invoke', id: 7, w: 1, key: 'transcript', args: ['s', undefined], at: new Date(5), m: new Map([[1, 'a']]), b: new Uint8Array([1, 2]) }
    const [back] = new FrameDecoder().push(encodeFrame(message))
    expect(back).toEqual(message)
    expect((back as { args: unknown[] }).args).toHaveLength(2)
  })

  it('reassembles a frame split across chunks, and several frames in one chunk', () => {
    const a = encodeFrame({ n: 1 })
    const b = encodeFrame({ n: 2, text: 'x'.repeat(10_000) })
    const c = encodeFrame({ n: 3 })
    const all = Buffer.concat([a, b, c])
    const decoder = new FrameDecoder()
    const got: unknown[] = []
    for (let i = 0; i < all.length; i += 7) got.push(...decoder.push(all.subarray(i, i + 7)))
    expect(got.map((m) => (m as { n: number }).n)).toEqual([1, 2, 3])
    expect(new FrameDecoder().push(all).map((m) => (m as { n: number }).n)).toEqual([1, 2, 3])
  })

  it('refuses a frame whose length is impossibly large, rather than allocating it', () => {
    const header = Buffer.alloc(4)
    header.writeUInt32BE(MAX_FRAME_BYTES + 1, 0)
    expect(() => new FrameDecoder().push(header)).toThrow(/too large/)
  })

  it('a handshake frame is JSON any version can read, and mixes with V8 frames on one stream', () => {
    const hello = { t: 'hello', protocol: 1, contract: 'abc', appVersion: '1.2.3' }
    const bytes = Buffer.concat([encodeHandshakeFrame(hello), encodeFrame({ t: 'open', w: 1 })])
    expect(JSON.parse(bytes.subarray(5, 4 + bytes.readUInt32BE(0)).toString('utf8'))).toEqual(hello)
    expect(new FrameDecoder().push(bytes)).toEqual([hello, { t: 'open', w: 1 }])
  })

  it('handshakeOnly reads JSON frames but refuses to deserialize a V8 one', () => {
    const decoder = new FrameDecoder()
    decoder.handshakeOnly = true
    expect(decoder.push(encodeHandshakeFrame({ t: 'hello' }))).toEqual([{ t: 'hello' }])
    expect(() => decoder.push(encodeFrame({ t: 'open', w: 1 }))).toThrow(/before the hello/)
  })

  it('refuses a frame of an unknown kind', () => {
    const bad = Buffer.from([0, 0, 0, 2, 9, 0])
    expect(() => new FrameDecoder().push(bad)).toThrow(/Unknown frame kind/)
  })

  it('a function cannot cross, as on Electron IPC', () => {
    expect(() => encodeFrame({ f: () => 1 })).toThrow()
  })
})

describe('remote channel scopes', () => {
  it('classifies every contract key, and nothing else', () => {
    expect(Object.keys(CHANNEL_SCOPES).sort()).toEqual(Object.keys(IPC).sort())
  })

  it('keeps the home machine\'s look, devices and app at home', () => {
    for (const key of ['themeApply', 'settingsSet', 'copyToClipboard', 'appMenuInvoke', 'editCommand', 'petsState', 'updateInstall'] as const) {
      expect([key, scopeOf(key)]).toEqual([key, 'local'])
    }
  })

  it('sends sessions, chat, terminals and git to the work machine', () => {
    for (const key of ['tree', 'transcript', 'chatSend', 'ptyWrite', 'ptyData', 'gitPull', 'treeChanged'] as const) {
      expect([key, scopeOf(key)]).toEqual([key, 'remote'])
    }
  })

  describe('the contract fingerprint', () => {
    /** Runs `read` with one channel of the contract changed by `change`, then puts it back. */
    const hashWith = (change: (spec: Record<string, unknown>) => void): string => {
      const spec = IPC.tree as unknown as Record<string, unknown>
      const before = { ...spec }
      try { change(spec); return contractHash() } finally { Object.assign(spec, before) }
    }

    it('is 16 hex digits, and the same for one contract', () => {
      expect(contractHash()).toMatch(/^[0-9a-f]{16}$/)
      expect(contractHash()).toBe(contractHash())
    })

    it('changes when a channel is renamed, so two builds that disagree about a call refuse each other', () => {
      expect(hashWith((spec) => { spec.channel = 'apiary:tree-renamed' })).not.toBe(contractHash())
    })

    it('changes when a channel changes kind', () => {
      expect(hashWith((spec) => { spec.kind = spec.kind === 'invoke' ? 'send' : 'invoke' })).not.toBe(contractHash())
    })

    it('changes when a channel is added, and is back to the first value once it is removed', () => {
      const first = contractHash()
      Object.assign(IPC, { zzProbe: { kind: 'invoke', channel: 'apiary:zz-probe' } })
      try { expect(contractHash()).not.toBe(first) } finally { Reflect.deleteProperty(IPC, 'zzProbe') }
      expect(contractHash()).toBe(first)
    })
  })
})
