import { describe, it, expect, vi } from 'vitest'
// (the contract's own guard refuses a non-boolean probe: tests/unit/ipcContract.test.ts)
import type { Ctx } from '../support'
import { REMOTE_WORLD } from '../world'

const NAMES: string[] = [...REMOTE_WORLD.recent]

/**
 * `remoteHosts` lists candidate hosts with what is known of each. Both sides are seeded with the
 * same recent hosts (`REMOTE_WORLD`) and the same canned probe: the loopback has no ssh, no
 * `~/.ssh/config` and no Tailscale, so recent hosts are all there is. A probe's answers arrive as
 * `remoteHostsChanged`, one per host. (The probing itself is tests/unit/hostDirectory.test.ts, and
 * tests/remote over real SSH.)
 */
export function defineRemoteHostsClauses(ctx: Ctx): void {
  describe('remoteHosts', () => {
    it('lists the recent hosts, most recent first, each with a source and a status nobody has checked yet', async () => {
      for (const probe of [false, true]) {
        const hosts = await ctx.api.remoteHosts(probe)
        expect(hosts.map((h) => h.name)).toEqual(NAMES)
        for (const h of hosts) {
          expect(h.source).toBe('recent')
          expect(h.status).toBe('unknown')
        }
      }
    })

    it('says nothing until it is asked to probe', async () => {
      await ctx.api.remoteHosts(false)
      expect(ctx.heard.count('remoteHostsChanged')).toBe(0)
    })

    it('announces what each probe found, as it ends, and keeps the list in the same order', async () => {
      await ctx.api.remoteHosts(true)
      await vi.waitFor(() => { expect(ctx.heard.count('remoteHostsChanged')).toBe(NAMES.length) })
      const last = ctx.heard.payloads('remoteHostsChanged').at(-1)?.[0]
      expect(last?.map((h) => [h.name, h.status])).toEqual([['work-box', 'ready'], ['lab-box', 'stopped']])
      expect(last?.every((h) => typeof h.checkedAt === 'number')).toBe(true)
      // What was found is what the next answer starts from.
      expect((await ctx.api.remoteHosts(false)).map((h) => h.status)).toEqual(['ready', 'stopped'])
    })
  })
}
