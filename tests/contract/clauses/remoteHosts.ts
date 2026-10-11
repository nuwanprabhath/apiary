import { describe, it, expect } from 'vitest'
// (the contract's own guard refuses a non-boolean probe: tests/unit/ipcContract.test.ts)
import type { Ctx } from '../support'

/**
 * `remoteHosts` lists candidate hosts with what is known of each. The loopback has no ssh, no
 * `~/.ssh/config` and no Tailscale, so only the recent hosts could appear (there are none): what
 * both sides owe is the shape, an empty list here, and that a probe request changes nothing about it.
 * (Probing for real is tests/unit/hostDirectory.test.ts, and tests/remote over real SSH.)
 */
export function defineRemoteHostsClauses(ctx: Ctx): void {
  describe('remoteHosts', () => {
    it('answers a list of hosts, each with a source and a status, whether or not it is asked to probe', async () => {
      for (const probe of [false, true]) {
        const hosts = await ctx.api.remoteHosts(probe)
        expect(Array.isArray(hosts)).toBe(true)
        for (const h of hosts) {
          expect(typeof h.name).toBe('string')
          expect(['recent', 'ssh-config', 'tailscale']).toContain(h.source)
          expect(['ready', 'off', 'stopped', 'refused', 'unreachable', 'unknown']).toContain(h.status)
        }
        const recent = hosts.map((h) => h.source).lastIndexOf('recent')
        expect(hosts.slice(0, recent + 1).every((h) => h.source === 'recent')).toBe(true)
      }
    })
  })
}
