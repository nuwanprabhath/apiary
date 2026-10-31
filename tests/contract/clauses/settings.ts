import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS_PAYLOAD } from '@shared/settingsDefaults'
import { STANDARD_TITLES, titles, type Ctx } from '../support'

export function defineSettingsClauses(ctx: Ctx): void {
  describe('settings', () => {
    it('answers every field of the shared payload, at its default on a fresh profile', async () => {
      const settings = await ctx.api.settingsGet()
      for (const key of Object.keys(DEFAULT_SETTINGS_PAYLOAD) as (keyof typeof DEFAULT_SETTINGS_PAYLOAD)[]) {
        expect(settings, `settingsGet is missing ${key}`).toHaveProperty(key)
      }
      expect(settings.searchChatContent).toBe(DEFAULT_SETTINGS_PAYLOAD.searchChatContent)
      expect(settings.recentSectionEnabled).toBe(DEFAULT_SETTINGS_PAYLOAD.recentSectionEnabled)
    })

    it('a partial save changes what it names and keeps everything else', async () => {
      const before = await ctx.api.settingsGet()
      await ctx.api.settingsSet({ terminalShortenPath: !before.terminalShortenPath } as never)
      const after = await ctx.api.settingsGet()
      expect(after.terminalShortenPath).toBe(!before.terminalShortenPath)
      expect({ ...after, terminalShortenPath: before.terminalShortenPath }).toEqual(before)
    })

    it('a key sent as undefined leaves the stored value alone', async () => {
      await ctx.api.settingsSet({ searchSessionNotes: false } as never)
      await ctx.api.settingsSet({ searchSessionNotes: undefined } as never)
      expect((await ctx.api.settingsGet()).searchSessionNotes).toBe(false)
    })

    it('a value of the wrong type is refused and the stored one stays', async () => {
      await ctx.api.settingsSet({ transcriptChat: true } as never)
      await ctx.api.settingsSet({ transcriptChat: 'no' } as never)
      expect((await ctx.api.settingsGet()).transcriptChat).toBe(true)
      await ctx.api.settingsSet({ plugins: { anything: 'on' } } as never)
      expect((await ctx.api.settingsGet()).plugins).not.toHaveProperty('anything')
    })

    it('a number outside its range is clamped into it', async () => {
      await ctx.api.settingsSet({ recentSectionHours: 100_000, terminalPathSegments: -4 } as never)
      const settings = await ctx.api.settingsGet()
      expect(settings.recentSectionHours).toBe(168)
      expect(settings.terminalPathSegments).toBe(1)
    })

    it('the path to claude must be absolute, or null', async () => {
      await ctx.api.settingsSet({ claudeBin: 'claude' } as never)
      expect((await ctx.api.settingsGet()).claudeBin).toBeNull()
      await ctx.api.settingsSet({ claudeBin: '/opt/claude/bin/claude' } as never)
      expect((await ctx.api.settingsGet()).claudeBin).toBe('/opt/claude/bin/claude')
      await ctx.api.settingsSet({ claudeBin: null } as never)
      expect((await ctx.api.settingsGet()).claudeBin).toBeNull()
    })

    it('switching auto-import on imports everything discovered, and says the tree changed', async () => {
      await ctx.restart({ imported: false })
      expect(await ctx.api.tree()).toEqual([])
      await ctx.api.settingsSet({ autoImportAll: true } as never)
      expect(titles(await ctx.api.tree())).toEqual([...STANDARD_TITLES].sort())
      expect(ctx.heard.count('treeChanged')).toBeGreaterThan(0)
    })
  })

  // In a local window "the machine it shows" is this one, so these read and write the same settings.
  describe('machine settings', () => {
    it('answers the machine keys of the settings and none of the screen ones', async () => {
      const machine = await ctx.api.machineSettingsGet()
      const all = await ctx.api.settingsGet()
      expect(machine.recentSectionHours).toBe(all.recentSectionHours)
      expect(machine).toHaveProperty('residents')
      expect(machine).toHaveProperty('plugins')
      expect(machine).not.toHaveProperty('motion')
      expect(machine).not.toHaveProperty('proofingLanguage')
    })

    it('a machine patch is saved like settingsSet, and says the machine settings changed', async () => {
      const before = ctx.heard.count('machineSettingsChanged')
      await ctx.api.machineSettingsSet({ recentSectionHours: 5 })
      expect((await ctx.api.settingsGet()).recentSectionHours).toBe(5)
      expect((await ctx.api.machineSettingsGet()).recentSectionHours).toBe(5)
      expect(ctx.heard.count('machineSettingsChanged')).toBeGreaterThan(before)
    })

    it('a patch naming a screen key is refused whole', async () => {
      await expect(ctx.api.machineSettingsSet({ recentSectionHours: 9, motion: 'reduced' })).rejects.toThrow()
      const settings = await ctx.api.settingsGet()
      expect(settings.recentSectionHours).toBe(DEFAULT_SETTINGS_PAYLOAD.recentSectionHours)
      expect(settings.motion).toBe(DEFAULT_SETTINGS_PAYLOAD.motion)
    })

    it('a value of the wrong type is refused as settingsSet refuses it', async () => {
      await ctx.api.machineSettingsSet({ transcriptChat: 'no' })
      expect((await ctx.api.settingsGet()).transcriptChat).toBe(DEFAULT_SETTINGS_PAYLOAD.transcriptChat)
    })

    it('the machine plugin list is this machine\'s plugin list', async () => {
      expect(await ctx.api.machinePluginList()).toEqual(await ctx.api.pluginList())
    })
  })
}
