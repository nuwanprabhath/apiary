import { describe, expect, it } from 'vitest'
import { asAccountId } from '@shared/domain/ids'
import { MAIN_ACCOUNT_ID } from '@shared/domain/accounts'
import { isPendingPtyId } from '@shared/domain/ptyId'
import { STANDARD_SESSIONS as STD } from '../../fixtures/standard'
import { LONG_SESSION, skipOnRemote, type Ctx } from '../support'

const LOCAL_ONLY = 'add, rename, remove and the default act on the machine the window runs on, which the loopback does not model'

export function defineAccountsClauses(ctx: Ctx): void {
  describe('accounts', () => {
    it('starts with the main account, which is the default', async () => {
      const state = await ctx.api.accountsList()
      expect(state.defaultId).toBe(MAIN_ACCOUNT_ID)
      expect(state.accounts.map((a) => ({ id: a.id, isMain: a.isMain }))).toEqual([{ id: MAIN_ACCOUNT_ID, isMain: true }])
    })

    it('an add returns a unique slug, lists the account and tells every window', async (t) => {
      skipOnRemote(t, ctx.bridge, LOCAL_ONLY)
      const first = await ctx.api.accountsAdd('Work Team')
      const second = await ctx.api.accountsAdd('work team')
      const reserved = await ctx.api.accountsAdd('Main')
      expect([first, second, reserved]).toEqual(['work-team', 'work-team-2', 'main-2'])
      const now = await ctx.api.accountsList()
      expect(now.accounts.map((a) => a.id)).toEqual([MAIN_ACCOUNT_ID, 'work-team', 'work-team-2', 'main-2'])
      expect(now.accounts.find((a) => a.id === first)).toMatchObject({ label: 'Work Team', email: null, isMain: false })
      await expect.poll(() => ctx.heard.payloads('accountsChanged').at(-1)?.[0]).toEqual(now)
    })

    it('the default can be set to an added account, and falls back to main when that account is removed', async (t) => {
      skipOnRemote(t, ctx.bridge, LOCAL_ONLY)
      const id = await ctx.api.accountsAdd('Personal')
      await ctx.api.accountsSetDefault(id)
      expect((await ctx.api.accountsList()).defaultId).toBe(id)
      await ctx.api.accountsRemove(id)
      const now = await ctx.api.accountsList()
      expect(now.defaultId).toBe(MAIN_ACCOUNT_ID)
      expect(now.accounts.map((a) => a.id)).toEqual([MAIN_ACCOUNT_ID])
      await expect.poll(() => ctx.heard.payloads('accountsChanged').at(-1)?.[0]).toEqual(now)
    })

    it('a rename changes the label, never the id, main included, and tells every window', async (t) => {
      skipOnRemote(t, ctx.bridge, LOCAL_ONLY)
      const id = await ctx.api.accountsAdd('Work')
      await ctx.api.accountsRename(id, 'Uni')
      await ctx.api.accountsRename(MAIN_ACCOUNT_ID, 'Personal')
      const now = await ctx.api.accountsList()
      expect(now.accounts.map((a) => [a.id, a.label])).toEqual([[MAIN_ACCOUNT_ID, 'Personal'], [id, 'Uni']])
      await expect.poll(() => ctx.heard.payloads('accountsChanged').at(-1)?.[0]).toEqual(now)
      await expect(ctx.api.accountsRename(id, '   ')).rejects.toThrow()
      await expect(ctx.api.accountsRename(asAccountId('ghost'), 'X')).rejects.toThrow()
    })

    it('main cannot be removed, and an unknown account cannot be the default', async (t) => {
      skipOnRemote(t, ctx.bridge, LOCAL_ONLY)
      await expect(ctx.api.accountsRemove(MAIN_ACCOUNT_ID)).rejects.toThrow()
      await expect(ctx.api.accountsSetDefault(asAccountId('ghost'))).rejects.toThrow()
      expect((await ctx.api.accountsList()).accounts).toHaveLength(1)
    })

    it('a call with a blank or over-long label, or a malformed id, is refused', async (t) => {
      skipOnRemote(t, ctx.bridge, LOCAL_ONLY)
      await expect(ctx.api.accountsAdd('   ')).rejects.toThrow()
      await expect(ctx.api.accountsAdd('x'.repeat(41))).rejects.toThrow()
      await expect(ctx.api.accountsRemove(asAccountId('Not An Id'))).rejects.toThrow()
      expect((await ctx.api.accountsList()).accounts).toHaveLength(1)
    })

    it('a login starts a pending terminal under the account, and an unknown account is refused', async (t) => {
      skipOnRemote(t, ctx.bridge, LOCAL_ONLY)
      const id = await ctx.api.accountsAdd('Login Me')
      const info = await ctx.api.accountsLogin(id)
      expect(isPendingPtyId(info.ptyId)).toBe(true)
      await expect(ctx.api.accountsLogin(asAccountId('Not An Id'))).rejects.toThrow()
    })

    it('switching a running chat to another account moves it there and tells every window', async (t) => {
      skipOnRemote(t, ctx.bridge, LOCAL_ONLY)
      const session = STD.csv.id
      const id = await ctx.api.accountsAdd('Switch To')
      await ctx.api.chatStart(session, { takeOver: false })
      expect((await ctx.api.sessionAccountsList())[session]).toBe(MAIN_ACCOUNT_ID)
      await ctx.api.sessionAccountSwitch(session, id)
      expect((await ctx.api.sessionAccountsList())[session]).toBe(id)
      expect(await ctx.api.sessionAccountGet(session)).toBe(id)
      await expect.poll(() => ctx.heard.payloads('sessionAccountsChanged').at(-1)?.[0]).toEqual({ [session]: id })
      await ctx.api.chatStop(session)
    })

    it('a session with no recorded account runs under the default account', async (t) => {
      skipOnRemote(t, ctx.bridge, LOCAL_ONLY)
      const id = await ctx.api.accountsAdd('Work')
      expect(await ctx.api.sessionAccountGet(LONG_SESSION.id)).toBe(MAIN_ACCOUNT_ID)
      await ctx.api.accountsSetDefault(id)
      expect(await ctx.api.sessionAccountGet(LONG_SESSION.id)).toBe(id)
    })
  })
}
