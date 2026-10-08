import { describe, expect, it } from 'vitest'
import { BUILTIN_THEMES } from '@shared/theme/builtins'
import type { Ctx } from '../support'

const SPEC = BUILTIN_THEMES[0].spec

export function defineThemeClauses(ctx: Ctx): void {
  describe('themes', () => {
    it('starts on the original look with nothing saved, every built-in on offer and the default effects options', async () => {
      const state = await ctx.api.themeState()
      expect(state).toMatchObject({ activeId: null, active: null, saved: [], safeMode: false })
      expect(state.options).toEqual({ animated: true, intensity: 1, model: 'sonnet' })
      expect(state.builtins.map((b) => b.id)).toEqual(BUILTIN_THEMES.map((b) => b.id))
    })

    it('hands the first paint the same theme state a later ask gets', async () => {
      expect(ctx.api.initialTheme).toEqual(await ctx.api.themeState())
    })

    it('saves a theme under the name it is given, lists it, and tells every view', async () => {
      const saved = await ctx.api.themeSave('My theme', SPEC, 'something calm')
      expect(saved).toMatchObject({ name: 'My theme', prompt: 'something calm' })
      expect(saved.id).not.toBe('')
      expect((await ctx.api.themeState()).saved.map((t) => t.id)).toEqual([saved.id])
      expect(ctx.heard.count('themeChanged')).toBe(1)
      expect(ctx.heard.payloads('themeChanged')[0][0].saved.map((t) => t.name)).toEqual(['My theme'])
    })

    it('applies a saved theme or a built-in one, goes back to the original look, and refuses a theme that does not exist', async () => {
      const saved = await ctx.api.themeSave('Mine', SPEC)
      await ctx.api.themeApply(saved.id)
      expect(await ctx.api.themeState()).toMatchObject({ activeId: saved.id, active: saved.spec })

      const builtin = BUILTIN_THEMES[1]
      await ctx.api.themeApply(builtin.id)
      expect(await ctx.api.themeState()).toMatchObject({ activeId: builtin.id, active: builtin.spec })

      await ctx.api.themeApply(null)
      expect(await ctx.api.themeState()).toMatchObject({ activeId: null, active: null })
      expect(ctx.heard.payloads('themeChanged').at(-1)?.[0].activeId).toBeNull()

      await expect(ctx.api.themeApply('no-such-theme')).rejects.toThrow()
      expect((await ctx.api.themeState()).activeId).toBeNull()
    })

    it('renames only a saved theme', async () => {
      const saved = await ctx.api.themeSave('Before', SPEC)
      await ctx.api.themeRename(saved.id, 'After')
      expect((await ctx.api.themeState()).saved[0]).toMatchObject({ id: saved.id, name: 'After' })
      expect((await ctx.api.themeState()).saved[0].spec.name).toBe('After')
      await expect(ctx.api.themeRename(BUILTIN_THEMES[0].id, 'Mine now')).rejects.toThrow()
    })

    it('deletes only a saved theme, and falls back to the original look when it was the one applied', async () => {
      const saved = await ctx.api.themeSave('Doomed', SPEC)
      await ctx.api.themeApply(saved.id)
      await ctx.api.themeDelete(saved.id)
      expect(await ctx.api.themeState()).toMatchObject({ activeId: null, active: null, saved: [] })
      await expect(ctx.api.themeDelete(saved.id)).rejects.toThrow()
      await expect(ctx.api.themeDelete(BUILTIN_THEMES[0].id)).rejects.toThrow()
    })

    it('keeps the effects options it can use: intensity is clamped, a field of the wrong kind is ignored', async () => {
      await ctx.api.themeSetOptions({ intensity: 7, animated: false, model: 'opus' })
      expect((await ctx.api.themeState()).options).toEqual({ animated: false, intensity: 1, model: 'opus' })
      await ctx.api.themeSetOptions({ intensity: 0.25, animated: 'yes', model: 'gpt' } as never)
      expect((await ctx.api.themeState()).options).toEqual({ animated: false, intensity: 0.25, model: 'opus' })
      expect(ctx.heard.count('themeChanged')).toBe(2)
    })

    it('designs a theme from a description, refuses a blank one, and can be told to stop', async () => {
      const designed = await ctx.api.themeGenerate('calm ocean blues', null)
      expect(typeof designed.spec.name).toBe('string')
      expect(designed.note === null || typeof designed.note === 'string').toBe(true)
      await expect(ctx.api.themeGenerate('   ', null)).rejects.toThrow()
      ctx.api.themeGenerateCancel()
      expect((await ctx.api.themeState()).saved).toEqual([])
    })
  })
}
