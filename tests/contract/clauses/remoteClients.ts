import { describe, expect, it } from 'vitest'
import type { Ctx } from '../support'

const CODE = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/

/**
 * The work machine's side of remote access, as its own Settings uses it: nobody is connected, the
 * pairing code is shown only while "Also require a pairing code" is on and is replaced on request,
 * and "Disconnect all" turns remote access off. (Clients really connecting, and the event that
 * follows, are tests/integration/remoteServer.test.ts: this loopback has no second machine.)
 */
export function defineRemoteClientsClauses(ctx: Ctx): void {
  describe('remote access, on the work machine', () => {
    it('lists nobody connected', async () => {
      expect(await ctx.api.remoteClients()).toEqual([])
    })

    it('has a pairing code as XXXX-XXXX without 0/O or 1/I, which stays until a new one is asked for', async () => {
      const first = await ctx.api.remotePairing()
      expect(first).toMatch(CODE)
      expect(await ctx.api.remotePairing()).toBe(first)
      const next = await ctx.api.remotePairingNew()
      expect(next).toMatch(CODE)
      expect(next).not.toBe(first)
      expect(await ctx.api.remotePairing()).toBe(next)
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
