import { describe, expect, it } from 'vitest'
import { asSessionId } from '@shared/domain/ids'
import { STANDARD_SESSIONS as STD } from '../../fixtures/standard'
import type { Ctx } from '../support'

export function defineBackgroundTaskOutputClauses(ctx: Ctx): void {
  describe('backgroundTaskOutput', () => {
    it('says a task the session never started has no output to show, and an unknown session the same', async () => {
      expect(await ctx.api.backgroundTaskOutput(STD.csv.id, 'b-not-a-task')).toEqual({ available: false, lines: [] })
      expect(await ctx.api.backgroundTaskOutput(asSessionId('00000000-0000-4000-8000-000000000000'), 'b1')).toEqual({ available: false, lines: [] })
    })

    it('refuses a task id that is not text', async () => {
      await expect(ctx.api.backgroundTaskOutput(STD.csv.id, 7 as never)).rejects.toThrow()
    })
  })
}
