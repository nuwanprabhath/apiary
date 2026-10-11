import { describe, it, expect } from 'vitest'
import type { Ctx } from '../support'

/**
 * `remoteConnect` takes the host the user typed and hands it to `ssh` as an argument. What both
 * sides must agree on is what is never let through: anything that could read as an ssh option or
 * carry a shell character is refused by the contract's own guard, before main starts any process.
 * (Connecting for real needs ssh and a second machine: tests/remote, the Docker bed.)
 */
export function defineRemoteConnectClauses(ctx: Ctx): void {
  describe('remoteConnect', () => {
    it('refuses a host that could be read as an ssh option or a shell command', async () => {
      for (const host of ['-oProxyCommand=touch /tmp/x', 'work box', 'work;id', 'work`id`', '$(id)', '', 'a'.repeat(300)]) {
        await expect(ctx.api.remoteConnect(host)).rejects.toThrow()
      }
    })
  })

  describe('remoteStartAndConnect', () => {
    it('refuses a host that could be read as an ssh option or a shell command, as remoteConnect does', async () => {
      for (const host of ['-oProxyCommand=touch /tmp/x', 'work box', 'work;id', 'work`id`', '$(id)', '', 'a'.repeat(300)]) {
        await expect(ctx.api.remoteStartAndConnect(host)).rejects.toThrow()
      }
    })
  })
}
