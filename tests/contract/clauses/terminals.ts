import { describe, expect, it } from 'vitest'
import { asPtyId, asSessionId, ptyIdOfSession } from '@shared/domain/ids'
import { newPendingPtyId } from '@shared/domain/ptyId'
import { STANDARD_SESSIONS as STD } from '../../fixtures/standard'
import type { Ctx } from '../support'

const UNKNOWN_SESSION = asSessionId('99999999-9999-9999-9999-999999999999')
/** A terminal id nothing was ever started under. */
const NOBODY = newPendingPtyId('99999999-9999-9999-9999-999999999999')

export function defineTerminalClauses(ctx: Ctx): void {
  describe('terminals', () => {
    it('a fresh profile has no running terminals', async () => {
      expect(await ctx.api.ptyRunning([ptyIdOfSession(STD.csv.id), newPendingPtyId(STD.csv.id)])).toEqual([])
      expect(await ctx.api.ptySessions()).toEqual({})
    })

    it('has no screen for a terminal that was never started, and ignores what is sent to one', async () => {
      expect(await ctx.api.ptySnapshot(NOBODY)).toBeNull()
      // The renderer sends these from views that outlive their process; none may fail or conjure a terminal.
      ctx.api.ptyAttach(NOBODY)
      ctx.api.ptyWrite(NOBODY, 'ls\r')
      ctx.api.ptyResize(NOBODY, 100, 30)
      ctx.api.ptyResume(NOBODY)
      ctx.api.ptyKill(NOBODY)
      ctx.api.ptyDetach(NOBODY)
      ctx.api.renameTerminalInClaude(NOBODY, 'a new name')
      expect(await ctx.api.sendPrompt(NOBODY, 'hello')).toBeUndefined()
      expect(await ctx.api.ptyRunning([NOBODY])).toEqual([])
      expect(ctx.heard.count('ptyExit')).toBe(0)
      expect(ctx.heard.count('ptyData')).toBe(0)
    })

    it('refuses to resume, or open a shell for, a session or terminal the app does not know', async () => {
      await expect(ctx.api.resume(UNKNOWN_SESSION)).rejects.toThrow()
      await expect(ctx.api.openShell(UNKNOWN_SESSION, '1')).rejects.toThrow()
      await expect(ctx.api.openShellForPty(NOBODY, '1')).rejects.toThrow()
      expect(await ctx.api.ptyRunning([ptyIdOfSession(UNKNOWN_SESSION), NOBODY, asPtyId('shell:x:1')])).toEqual([])
    })

    it('refuses what is not a well-formed terminal call', async () => {
      await expect(ctx.api.ptyRunning('everything' as never)).rejects.toThrow()
      await expect(ctx.api.openShell(STD.csv.id, 7 as never)).rejects.toThrow()
    })
  })
}
