import { describe, expect, it, vi } from 'vitest'
import { formatPairingCode, normalizePairingCode, PAIRING_CODE_PATTERN } from '@shared/domain/remote'
import type { Ctx } from '../support'

/** A code as Settings shows it: the pairing alphabet, upper case, in two groups of four. */
const isShown = (code: string): boolean => PAIRING_CODE_PATTERN.test(code) && formatPairingCode(normalizePairingCode(code)) === code

/**
 * The work machine's side of remote access, as its own Settings uses it: nobody is connected, the
 * pairing code is shown only while "Also require a pairing code" is on and is replaced on request,
 * and "Disconnect all" turns remote access off. (Clients really connecting, and the event that
 * follows, are tests/integration/remoteServer.test.ts: this loopback has no second machine.)
 */
export function defineRemoteClientsClauses(ctx: Ctx): void {
  describe('remote access, on the work machine', () => {
    it('lists nobody until a home machine connects, then lists it by name with no windows open, and announces the list', async () => {
      expect(await ctx.api.remoteClients()).toEqual([])
      await ctx.bridge.outside.remoteClientConnects('home-mac')
      await vi.waitFor(() => { expect(ctx.heard.count('remoteClientsChanged')).toBeGreaterThan(0) })
      const listed = await ctx.api.remoteClients()
      expect(listed.map((c) => [c.client, c.windows])).toEqual([['home-mac', 0]])
      expect(ctx.heard.payloads('remoteClientsChanged').at(-1)?.[0]).toEqual(listed)
    })

    it('reports its server as off until remote access is started, and announces nothing for that', async () => {
      expect(await ctx.api.remoteServerState()).toEqual({ state: 'off' })
      expect(ctx.heard.count('remoteServerStateChanged')).toBe(0)
    })

    it('has a pairing code as XXXX-XXXX without 0/O or 1/I, which stays until a new one is asked for', async () => {
      const first = await ctx.api.remotePairing()
      expect(isShown(first)).toBe(true)
      expect(await ctx.api.remotePairing()).toBe(first)
      let previous = first
      // Every request, not only the first, brings a fresh valid code.
      for (let i = 0; i < 3; i++) {
        const next = await ctx.api.remotePairingNew()
        expect(isShown(next)).toBe(true)
        expect(next).not.toBe(previous)
        expect(await ctx.api.remotePairing()).toBe(next)
        previous = next
      }
    })

    it('drops a connected home machine on "Disconnect all" and announces the empty list', async () => {
      await ctx.bridge.outside.remoteClientConnects('home-mac')
      await vi.waitFor(async () => { expect(await ctx.api.remoteClients()).toHaveLength(1) })
      ctx.heard.reset()
      await ctx.api.remoteDisconnectAll()
      await vi.waitFor(() => { expect(ctx.heard.payloads('remoteClientsChanged').at(-1)?.[0]).toEqual([]) })
      expect(await ctx.api.remoteClients()).toEqual([])
    })

    it('turns remote access off on "Disconnect all", so nothing reconnects by itself', async () => {
      await ctx.api.settingsSet({ remoteAccess: true } as never)
      expect((await ctx.api.settingsGet()).remoteAccess).toBe(true)
      ctx.heard.reset()
      await ctx.api.remoteDisconnectAll()
      expect((await ctx.api.settingsGet()).remoteAccess).toBe(false)
      // Nobody was connected, so the list did not change and nothing is announced.
      expect(ctx.heard.count('remoteClientsChanged')).toBe(0)
    })
  })

  describe('remoteConnect with a pairing code', () => {
    it('refuses a code that is not 8 characters from the pairing alphabet, before any ssh', async () => {
      for (const code of ['', 'ABC', 'ABCD-EFG0', 'ABCD-EFGI', 'abcd efgh', 'ABCD-EFGH-JKLM', '$(id)']) {
        await expect(ctx.api.remoteConnect('work-box', code)).rejects.toThrow()
      }
    })
  })
}
