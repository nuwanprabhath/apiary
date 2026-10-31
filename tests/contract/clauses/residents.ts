import { describe, expect, it } from 'vitest'
import type { ResidentConfig } from '@shared/domain/residents'
import { flatten, skipOnRemote, type Ctx } from '../support'
import { BROWSE_HOME } from '../world'

const RUNS_CLAUDE = 'a resident runs a claude on the machine the window runs on, over that machine\'s sessions'
const ANSWER = { timeout: 15_000, interval: 100 }

export function defineResidentsClauses(ctx: Ctx): void {
  /**
   * Saves only `residents`. A whole settings object would carry `claudeBin: null` and point the
   * loopback's claude back at the real one on PATH.
   */
  const saveResidents = async (residents: ResidentConfig[]): Promise<void> => {
    await ctx.api.settingsSet({ residents } as never)
  }
  /** Adds Regent and switches it on, through the setting as the Settings section does. */
  const enabledRegent = async (): Promise<ResidentConfig> => {
    const added = await ctx.api.residentsAdd('regent')
    await saveResidents((await ctx.api.settingsGet()).residents.map((c) => (c.id === added.id ? { ...c, enabled: true } : c)))
    return added
  }

  describe('residents', () => {
    it('starts with none', async () => {
      expect(await ctx.api.residentsList()).toEqual([])
    })

    it('an add appends the kind\'s defaults under a fresh id, switched off, and tells every window', async () => {
      const first = await ctx.api.residentsAdd('regent')
      const second = await ctx.api.residentsAdd('regent')
      expect(first).toMatchObject({
        id: 'regent', kind: 'regent', name: 'Regent', enabled: false, model: 'sonnet', digestModel: 'haiku',
        schedule: { days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' }, pauseAboveUsagePercent: 70,
      })
      expect(second.id).toBe('regent-2')
      expect((await ctx.api.settingsGet()).residents.map((c) => c.id)).toEqual(['regent', 'regent-2'])
      const listed = await ctx.api.residentsList()
      expect(listed.map((s) => [s.id, s.state, s.appearance.glyph])).toEqual([['regent', 'asleep', 'bee'], ['regent-2', 'asleep', 'bee']])
      await expect.poll(() => ctx.heard.payloads('residentsChanged').at(-1)?.[0].map((s) => s.id)).toEqual(['regent', 'regent-2'])
    })

    it('a rename in the setting reaches the status and every window', async () => {
      await ctx.api.residentsAdd('regent')
      await saveResidents((await ctx.api.settingsGet()).residents.map((c) => ({ ...c, name: '  Chief  ' })))
      expect((await ctx.api.residentsList())[0].name).toBe('Chief')
      await expect.poll(() => ctx.heard.payloads('residentsChanged').at(-1)?.[0][0]?.name).toBe('Chief')
    })

    it('an unknown resident is refused; a new one has no history', async () => {
      await expect(ctx.api.residentHistory('ghost')).rejects.toThrow()
      await expect(ctx.api.residentStop('ghost')).rejects.toThrow()
      await expect(ctx.api.residentClear('ghost')).rejects.toThrow()
      await expect(ctx.api.residentRedigest('ghost')).rejects.toThrow()
      await ctx.api.residentsAdd('regent')
      expect(await ctx.api.residentHistory('regent')).toEqual([])
      await ctx.api.residentStop('regent')
      await ctx.api.residentRedigest('regent')
    })

    it('a resident that is switched off, or an empty message, is refused', async () => {
      await ctx.api.residentsAdd('regent')
      await expect(ctx.api.residentSend('regent', 'hello')).rejects.toThrow()
      expect(await ctx.api.residentHistory('regent')).toEqual([])
    })

    it('an enabled resident answers: the message, then the streamed answer, both kept in its history; clear empties it', async (t) => {
      skipOnRemote(t, ctx.bridge, RUNS_CLAUDE)
      await enabledRegent()
      await expect(ctx.api.residentSend('regent', '   ')).rejects.toThrow()
      // No knowledge index yet: no instant matches.
      expect(await ctx.api.residentSend('regent', 'hello')).toEqual([])
      await expect.poll(async () => (await ctx.api.residentHistory('regent')).map((m) => [m.role, m.text]), ANSWER)
        .toEqual([['user', 'hello'], ['assistant', 'You said: hello']])
      const pushed = ctx.heard.payloads('residentMessage').map(([p]) => p)
      expect(pushed.every((p) => p.residentId === 'regent')).toBe(true)
      expect(pushed.at(-1)?.message).toMatchObject({ role: 'assistant', text: 'You said: hello', streaming: false })
      await ctx.api.residentClear('regent')
      expect(await ctx.api.residentHistory('regent')).toEqual([])
    })

    it('a resident\'s open_session asks the window to show that session', async (t) => {
      skipOnRemote(t, ctx.bridge, RUNS_CLAUDE)
      await enabledRegent()
      await ctx.api.residentSend('regent', 'hello')
      await expect.poll(async () => (await ctx.api.residentHistory('regent')).length, ANSWER).toBe(2)
      const session = flatten(await ctx.api.tree())[0].session
      await ctx.bridge.outside.residentOpensSession('regent', session.sessionId)
      await expect.poll(() => ctx.heard.payloads('openSessionRequested').map(([id]) => id)).toEqual([session.sessionId])
    })

    it('residentKinds lists every kind with its name, fields, digest flag and look', async () => {
      const kinds = await ctx.api.residentKinds()
      expect(kinds.map((k) => [k.id, k.defaultName, k.digests, k.appearance.glyph])).toEqual([
        ['regent', 'Regent', true, 'bee'], ['mr-desk', 'MR Desk', false, 'honeypot'],
      ])
      expect(kinds[0].optionFields).toEqual([])
      expect(kinds[1].optionFields.map((f) => [f.key, f.input, f.required])).toEqual([
        ['project', 'text', true], ['repoPath', 'folder', true], ['username', 'text', false],
      ])
      expect(kinds[0].blurb).not.toBe('')
    })

    it('a new resident has nothing waiting, no attention and no kind actions; a kind not ready says why', async () => {
      await ctx.api.residentsAdd('regent')
      await ctx.api.residentsAdd('mr-desk')
      const [regent, desk] = await ctx.api.residentsList()
      expect(regent).toMatchObject({ permissions: [], attention: null, quickActions: [], setupNeeded: null })
      expect(desk).toMatchObject({ id: 'mr-desk', setupNeeded: 'Set the GitLab project in Settings', appearance: { glyph: 'honeypot' } })
      const saved = (await ctx.api.settingsGet()).residents[0]
      expect(saved).toMatchObject({ permissionMode: 'auto', digestLookback: null, options: {} })
    })

    it('seen, a permission answer for an id not waiting, and a lookback change are accepted; an unknown resident is refused', async () => {
      await ctx.api.residentsAdd('regent')
      await ctx.api.residentSeen('regent')
      await ctx.api.residentPermissionAnswer('regent', 'not-waiting', true)
      expect((await ctx.api.residentsList())[0]).toMatchObject({ attention: null, permissions: [] })
      await saveResidents((await ctx.api.settingsGet()).residents.map((c) => ({ ...c, digestLookback: { amount: 3, unit: 'weeks' as const } })))
      expect((await ctx.api.settingsGet()).residents[0].digestLookback).toEqual({ amount: 3, unit: 'weeks' })
      await expect(ctx.api.residentSeen('ghost')).rejects.toThrow()
      await expect(ctx.api.residentPermissionAnswer('ghost', 'r', false)).rejects.toThrow()
    })

    it('an action the kind does not have, or a folder option it does not have, is refused', async () => {
      await ctx.api.residentsAdd('regent')
      await expect(ctx.api.residentQuickAction('regent', 'nope')).rejects.toThrow()
      await expect(ctx.api.residentQuickAction('ghost', 'nope')).rejects.toThrow()
      await expect(ctx.api.residentPickFolder('regent', 'clone')).rejects.toThrow()
      await expect(ctx.api.residentPickFolder('regent', '../etc')).rejects.toThrow()
      expect((await ctx.api.settingsGet()).residents[0].options).toEqual({})
    })

    // A remote window has no folder dialog: its resident card chooses with the in-app browser,
    // which holds the position on the machine that stores it, so no path crosses.
    it('a folder option can be set to the folder an in-app browse shows, and only a folder option', async () => {
      await ctx.api.residentsAdd('mr-desk')
      const { id } = await ctx.api.folderBrowseOpen()
      await ctx.api.folderBrowseEnter(id, BROWSE_HOME.nested.parent)
      const stored = await ctx.api.residentUseBrowsedFolder('mr-desk', 'repoPath', id)
      expect(stored.endsWith(`/${BROWSE_HOME.nested.parent}`)).toBe(true)
      expect((await ctx.api.settingsGet()).residents.find((c) => c.id === 'mr-desk')?.options.repoPath).toBe(stored)
      await expect(ctx.api.residentUseBrowsedFolder('mr-desk', 'project', id)).rejects.toThrow()
      ctx.api.folderBrowseClose(id)
      await expect(ctx.api.residentUseBrowsedFolder('mr-desk', 'repoPath', id)).rejects.toThrow()
    })
  })
}
