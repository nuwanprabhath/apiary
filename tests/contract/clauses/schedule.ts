import { describe, expect, it } from 'vitest'
import { asSessionId } from '@shared/domain/ids'
import { STANDARD_SESSIONS as STD } from '../../fixtures/standard'
import type { Ctx } from '../support'

const MINUTE = 60_000
const GHOST_ID = '00000000-0000-4000-8000-000000000000'

export function defineScheduleClauses(ctx: Ctx): void {
  describe('scheduled messages', () => {
    it('a schedule is saved trimmed, listed for its session and everywhere, and tells every window', async () => {
      const at = Date.now() + 30 * MINUTE
      const saved = await ctx.api.scheduleSet({ id: null, sessionId: STD.csv.id, text: '  continue \n', at })
      expect(saved).toMatchObject({ sessionId: STD.csv.id, text: 'continue', at })
      expect((await ctx.api.scheduleList(STD.csv.id)).messages.map((m) => m.id)).toEqual([saved.id])
      expect((await ctx.api.scheduleList(STD.switcher.id)).messages).toEqual([])
      expect((await ctx.api.scheduleList(null)).messages.map((m) => m.text)).toEqual(['continue'])
      await expect.poll(() => ctx.heard.payloads('scheduleChanged').at(-1)?.[0].messages.map((m) => m.id)).toEqual([saved.id])
    })

    it('an edit replaces the schedule in place, keeping its id', async () => {
      const first = await ctx.api.scheduleSet({ id: null, sessionId: STD.csv.id, text: 'continue', at: Date.now() + 30 * MINUTE })
      const at = Date.now() + 90 * MINUTE
      const edited = await ctx.api.scheduleSet({ id: first.id, sessionId: STD.csv.id, text: 'keep going', at })
      expect(edited.id).toBe(first.id)
      const listed = (await ctx.api.scheduleList(null)).messages
      expect(listed.map((m) => [m.id, m.text, m.at])).toEqual([[first.id, 'keep going', at]])
    })

    it('a cancel removes it and tells every window; cancelling again is a no-op', async () => {
      const saved = await ctx.api.scheduleSet({ id: null, sessionId: STD.csv.id, text: 'continue', at: Date.now() + 30 * MINUTE })
      await ctx.api.scheduleCancel(saved.id)
      expect((await ctx.api.scheduleList(null)).messages).toEqual([])
      await expect.poll(() => ctx.heard.payloads('scheduleChanged').at(-1)?.[0].messages).toEqual([])
      const heard = ctx.heard.count('scheduleChanged')
      await ctx.api.scheduleCancel(saved.id)
      expect(ctx.heard.count('scheduleChanged')).toBe(heard)
    })

    it('Send now takes the schedule off the list at once', async () => {
      const saved = await ctx.api.scheduleSet({ id: null, sessionId: STD.csv.id, text: 'continue', at: Date.now() + 30 * MINUTE })
      await ctx.api.scheduleSendNow(saved.id)
      expect((await ctx.api.scheduleList(null)).messages).toEqual([])
      await expect(ctx.api.scheduleSendNow(saved.id)).rejects.toThrow()
    })

    it('refuses blank or over-long text, a past or far time, an unknown session or schedule, and a malformed id', async () => {
      const soon = Date.now() + 30 * MINUTE
      await expect(ctx.api.scheduleSet({ id: null, sessionId: STD.csv.id, text: '   ', at: soon })).rejects.toThrow()
      await expect(ctx.api.scheduleSet({ id: null, sessionId: STD.csv.id, text: 'x'.repeat(10_001), at: soon })).rejects.toThrow()
      await expect(ctx.api.scheduleSet({ id: null, sessionId: STD.csv.id, text: 'continue', at: Date.now() - MINUTE })).rejects.toThrow()
      await expect(ctx.api.scheduleSet({ id: null, sessionId: STD.csv.id, text: 'continue', at: Date.now() + 31 * 24 * 60 * MINUTE })).rejects.toThrow()
      await expect(ctx.api.scheduleSet({ id: null, sessionId: asSessionId('no-such-session'), text: 'continue', at: soon })).rejects.toThrow()
      await expect(ctx.api.scheduleSet({ id: GHOST_ID, sessionId: STD.csv.id, text: 'continue', at: soon })).rejects.toThrow()
      await expect(ctx.api.scheduleCancel('../../etc/passwd')).rejects.toThrow()
      expect((await ctx.api.scheduleList(null)).messages).toEqual([])
    })

    it('with no limit known, suggests an hour from now, up to the next five minutes', async () => {
      const before = Date.now()
      const suggested = await ctx.api.scheduleDefault(STD.csv.id)
      expect(suggested.source).toBe('hour')
      expect(suggested.resetsAt).toBeNull()
      expect(suggested.at % (5 * MINUTE)).toBe(0)
      expect(suggested.at).toBeGreaterThanOrEqual(before + 60 * MINUTE)
      expect(suggested.at).toBeLessThanOrEqual(Date.now() + 65 * MINUTE)
    })
  })
}
