import { describe, it, expect } from 'vitest'
import type { Ctx } from '../support'

/** `remoteStatusNow` answers for the asking window: an ordinary window was never sent a status, so it hears null. */
export function defineRemoteStatusNowClauses(ctx: Ctx): void {
  describe('remoteStatusNow', () => {
    it('is null in a window that is not a remote one', async () => {
      expect(await ctx.api.remoteStatusNow()).toBeNull()
    })
  })
}
