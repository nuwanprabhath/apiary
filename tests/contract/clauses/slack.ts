import { describe, expect, it } from 'vitest'
import type { Ctx } from '../support'

const TOKEN = 'xoxb-1111-2222-contractsecret'

export function defineSlackClauses(ctx: Ctx): void {
  describe('slack', () => {
    it('slackConfigure with a token and channel answers connected and emits slackChanged', async () => {
      const status = await ctx.api.slackConfigure({ token: TOKEN, channel: '#work', ownerId: 'UOWNER001', enabled: true })
      expect(status).toMatchObject({
        enabled: true, hasToken: true, channel: { name: 'work' }, ownerId: 'UOWNER001', connection: 'connected', error: null,
      })
      expect(status.bot).not.toBeNull()
      await expect.poll(() => ctx.heard.payloads('slackChanged').at(-1)?.[0].connection).toBe('connected')
      expect(await ctx.api.slackStatus()).toEqual(status)
    })

    it('slackConfigure refuses a token that is not a bot token', async () => {
      await expect(ctx.api.slackConfigure({ token: 'xoxp-user-token' })).rejects.toThrow()
      await expect(ctx.api.slackConfigure({ ownerId: 'not-a-member' })).rejects.toThrow()
      expect((await ctx.api.slackStatus()).hasToken).toBe(false)
    })

    it('slackStatus never carries the token', async () => {
      await ctx.api.slackConfigure({ token: TOKEN, channel: 'work', ownerId: 'UOWNER001', enabled: true })
      expect(JSON.stringify(await ctx.api.slackStatus())).not.toContain(TOKEN)
      expect(JSON.stringify(ctx.heard.payloads('slackChanged'))).not.toContain(TOKEN)
    })

    it('slackTest answers the current state', async () => {
      await ctx.api.slackConfigure({ token: TOKEN, channel: 'work', ownerId: 'UOWNER001', enabled: true })
      expect((await ctx.api.slackTest()).connection).toBe('connected')
    })
  })
}
