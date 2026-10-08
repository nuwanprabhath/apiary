import { describe, expect, it } from 'vitest'
import { asSessionId } from '@shared/domain/ids'
import { STANDARD_SESSIONS as STD } from '../../fixtures/standard'
import type { Ctx } from '../support'

const SESSION = STD.csv.id
const OTHER = STD.switcher.id

export function defineChatClauses(ctx: Ctx): void {
  const start = (id = SESSION): ReturnType<Ctx['api']['chatStart']> => ctx.api.chatStart(id, { takeOver: false })

  describe('chat', () => {
    it('a window can attach and detach the session it shows, twice over, and hear chat lifecycles, with no chat running', () => {
      ctx.api.chatAttach(SESSION)
      ctx.api.chatAttach(SESSION)
      ctx.api.chatDetach(SESSION)
      ctx.api.chatDetach(SESSION)
      expect(ctx.heard.payloads('chatLifecycle')).toEqual([])
    })

    it('has no state for a session nobody chats with, and starts one that is ready for a message', async () => {
      expect(await ctx.api.chatState(SESSION)).toBeNull()
      const started = await start()
      expect(started).toMatchObject({ sessionId: SESSION, status: 'idle', error: null, previousSessionId: null, permissions: [], live: [] })
      expect(await ctx.api.chatState(SESSION)).toMatchObject({ sessionId: SESSION, status: 'idle' })
      expect(await ctx.api.chatState(OTHER)).toBeNull()
    })

    it('starting a session that is already chatting answers the chat it has, and announces nothing more', async () => {
      await start()
      ctx.heard.reset()
      expect(await start()).toMatchObject({ sessionId: SESSION, status: 'idle' })
      expect(ctx.heard.count('chatLifecycle')).toBe(0)
    })

    it('every window hears a chat start and end, but only a window that attached the session gets its state', async () => {
      await start(OTHER)
      expect(ctx.heard.payloads('chatLifecycle')).toEqual([[{ sessionId: OTHER, previousSessionId: null, running: true }]])
      expect(ctx.heard.count('chatChanged')).toBe(0)

      ctx.api.chatAttach(SESSION)
      await start()
      expect(ctx.heard.payloads('chatChanged')[0][0]).toMatchObject({ sessionId: SESSION, status: 'idle' })
      expect(ctx.heard.payloads('chatChanged').every(([state]) => state.sessionId === SESSION)).toBe(true)

      // Detached again, a window hears no more of it, whatever the chat does.
      ctx.api.chatDetach(SESSION)
      const heardBefore = ctx.heard.count('chatChanged')
      await ctx.api.chatSetPermissionMode(SESSION, 'plan')
      expect(ctx.heard.count('chatChanged')).toBe(heardBefore)

      await ctx.api.chatStop(OTHER)
      await ctx.api.chatStop(SESSION)
      // Each chat run ends once: a reply still in flight when the process ended must not announce it again (B21).
      const said = ctx.heard.payloads('chatLifecycle').map(([c]) => `${c.sessionId}:${String(c.running)}`)
      expect(said).toEqual([`${OTHER}:true`, `${SESSION}:true`, `${OTHER}:false`, `${SESSION}:false`])
    })

    it('a message sent makes the chat busy and waits in its queue until Claude reads it', async () => {
      await start()
      await ctx.api.chatSend(SESSION, 'hello there')
      const sent = await ctx.api.chatState(SESSION)
      expect(sent?.status).toBe('busy')
      expect(sent?.queued.map((q) => q.text)).toEqual(['hello there'])
    })

    it('a permission mode chosen shows at once, in the state and to a window that attached the chat', async () => {
      ctx.api.chatAttach(SESSION)
      await start()
      await ctx.api.chatSetPermissionMode(SESSION, 'plan')
      expect((await ctx.api.chatState(SESSION))?.permissionMode).toBe('plan')
      expect(ctx.heard.payloads('chatChanged').at(-1)?.[0].permissionMode).toBe('plan')
    })

    it('accepts an interrupt, an answer to a question nobody asked, a model and an effort for a chat that is running', async () => {
      await start()
      await ctx.api.chatInterrupt(SESSION)
      await ctx.api.chatRespond(SESSION, 'no-such-request', { behavior: 'allow' })
      await ctx.api.chatSetModel(SESSION, 'haiku')
      await ctx.api.chatSetEffort(SESSION, 'high')
      expect((await ctx.api.chatState(SESSION))?.permissions).toEqual([])
    })

    it('refuses to drive a session that is not chatting', async () => {
      await expect(ctx.api.chatSend(SESSION, 'hello')).rejects.toThrow()
      await expect(ctx.api.chatInterrupt(SESSION)).rejects.toThrow()
      await expect(ctx.api.chatRespond(SESSION, 'r', { behavior: 'deny' })).rejects.toThrow()
      await expect(ctx.api.chatSetPermissionMode(SESSION, 'plan')).rejects.toThrow()
      await expect(ctx.api.chatSetModel(SESSION, 'haiku')).rejects.toThrow()
      await expect(ctx.api.chatSetEffort(SESSION, 'low')).rejects.toThrow()
    })

    it('refuses a mode, model, effort or decision it does not know, and a session the app does not know', async () => {
      await start()
      await expect(ctx.api.chatSetPermissionMode(SESSION, 'yolo' as never)).rejects.toThrow()
      await expect(ctx.api.chatSetEffort(SESSION, 'extreme' as never)).rejects.toThrow()
      await expect(ctx.api.chatSetModel(SESSION, 'not a model!')).rejects.toThrow()
      await expect(ctx.api.chatRespond(SESSION, 'r', { behavior: 'maybe' } as never)).rejects.toThrow()
      await expect(ctx.api.chatStart(asSessionId('99999999-9999-9999-9999-999999999999'), { takeOver: false })).rejects.toThrow()
    })

    it('stopping ends the chat: a window that showed it keeps the ended state, one that did not finds nothing', async () => {
      ctx.api.chatAttach(SESSION)
      await start()
      await start(OTHER)
      await ctx.api.chatStop(SESSION)
      await ctx.api.chatStop(OTHER)
      expect(await ctx.api.chatState(SESSION)).toMatchObject({ status: 'exited', error: null })
      expect(await ctx.api.chatState(OTHER)).toBeNull()
      // Once the window lets go of it, it is forgotten too.
      ctx.api.chatDetach(SESSION)
      expect(await ctx.api.chatState(SESSION)).toBeNull()
      // And it can be started again.
      expect(await start()).toMatchObject({ status: 'idle' })
    })

    it('a session without a terminal of its own is not busy', async () => {
      expect(await ctx.api.terminalBusy(SESSION)).toEqual({ busy: false, backgroundTasks: 0 })
    })
  })
}
