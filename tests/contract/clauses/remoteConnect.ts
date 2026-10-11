import { describe, it, expect, vi } from 'vitest'
import type { Ctx } from '../support'
import { noMachineMessage, pairingSeenMessage, REMOTE_WORLD } from '../world'

/** Hosts that could read as an ssh option or carry a shell character. */
const HOSTILE_HOSTS = ['-oProxyCommand=touch /tmp/x', 'work box', 'work;id', 'work`id`', '$(id)', '', 'a'.repeat(300)]

/**
 * `remoteConnect` takes the host the user typed and hands it to `ssh` as an argument. What both
 * sides must agree on is what is never let through: anything that could read as an ssh option or
 * carry a shell character is refused by the contract's own guard, before main starts any process.
 * A host that passes is then really connected to, by the real client service with ssh stubbed
 * (`REMOTE_WORLD`): one that cannot be reached fails in ssh's own words, and a connection that works
 * puts the host first in the recent list and announces it. (Over real ssh and a second machine:
 * tests/remote, the Docker bed.)
 */
export function defineRemoteConnectClauses(ctx: Ctx): void {
  describe('remoteConnect', () => {
    it('refuses a host that could be read as an ssh option or a shell command', async () => {
      for (const host of HOSTILE_HOSTS) {
        await expect(ctx.api.remoteConnect(host)).rejects.toThrow()
      }
    })
  })

  describe('remoteConnect to a host that passes the guard', () => {
    it('fails in the words of the ssh failure when the host cannot be reached, and announces nothing', async () => {
      await expect(ctx.api.remoteConnect(REMOTE_WORLD.gone)).rejects.toThrow(noMachineMessage(REMOTE_WORLD.gone))
      expect(ctx.heard.count('remoteHostsChanged')).toBe(0)
    })

    it('hands the pairing code it was given to the connection, and none when it was given none', async () => {
      await expect(ctx.api.remoteConnect(REMOTE_WORLD.pairing, 'ABCD-EFGH')).rejects.toThrow(pairingSeenMessage('ABCD-EFGH'))
      await expect(ctx.api.remoteConnect(REMOTE_WORLD.pairing)).rejects.toThrow(pairingSeenMessage(undefined))
    })

    it('puts the host first in the recent list, ready, and announces the list once it is connected', async () => {
      await ctx.api.remoteConnect(REMOTE_WORLD.up)
      const announced = ctx.heard.payloads('remoteHostsChanged')
      expect(announced).toHaveLength(1)
      const expected = [[REMOTE_WORLD.up, 'ready'], ...REMOTE_WORLD.recent.map((name) => [name, 'unknown'])]
      expect(announced[0][0].map((h) => [h.name, h.status])).toEqual(expected)
      expect((await ctx.api.remoteHosts(false)).map((h) => [h.name, h.status])).toEqual(expected)
    })
  })

  describe('remoteStartAndConnect', () => {
    it('refuses a host that could be read as an ssh option or a shell command, as remoteConnect does', async () => {
      for (const host of HOSTILE_HOSTS) {
        await expect(ctx.api.remoteStartAndConnect(host)).rejects.toThrow()
      }
    })

    it('probes the host first, announces the probe, and says so when ssh cannot get in', async () => {
      await expect(ctx.api.remoteStartAndConnect(REMOTE_WORLD.gone)).rejects.toThrow(noMachineMessage(REMOTE_WORLD.gone))
      await vi.waitFor(() => { expect(ctx.heard.count('remoteHostsChanged')).toBe(1) })
    })

    it('says remote access is off there when the probe finds no socket, instead of connecting', async () => {
      await expect(ctx.api.remoteStartAndConnect('lab-box')).rejects.toThrow(/lab-box, but remote access is off there/)
      expect(ctx.heard.payloads('remoteHostsChanged').at(-1)?.[0].find((h) => h.name === 'lab-box')?.status).toBe('stopped')
    })

    it('announces the probe and then the connection when the host is ready and works', async () => {
      await ctx.api.remoteStartAndConnect(REMOTE_WORLD.up)
      expect(ctx.heard.count('remoteHostsChanged')).toBe(2)
      expect(ctx.heard.payloads('remoteHostsChanged').at(-1)?.[0][0]).toMatchObject({ name: REMOTE_WORLD.up, source: 'recent', status: 'ready' })
    })
  })
}
