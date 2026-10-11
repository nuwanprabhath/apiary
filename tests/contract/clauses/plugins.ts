import { describe, expect, it } from 'vitest'
import type { PluginBarItem } from '@shared/domain/plugins'
import { STANDARD_SESSIONS as STD } from '../../fixtures/standard'
import type { Ctx } from '../support'
import { BAR_ITEM, BAR_PLUGIN, CONSENT_ITEM, CONSENT_PLUGIN, STATUS_ITEM, STATUS_PANEL, STATUS_PLUGIN } from '../world'

const repoSession = { kind: 'session', id: STD.repoRoot.id } as const

export function definePluginClauses(ctx: Ctx): void {
  describe('plugins', () => {
    it('lists each plugin once with its name, whether it is on, the settings it declares and their values', async () => {
      const plugins = await ctx.api.pluginList()
      expect(new Set(plugins.map((p) => p.id)).size).toBe(plugins.length)
      expect(plugins.map((p) => p.id).sort()).toEqual([BAR_PLUGIN.id, CONSENT_PLUGIN.id, STATUS_PLUGIN.id].sort())
      const bar = plugins.find((p) => p.id === BAR_PLUGIN.id)
      expect(bar).toMatchObject({ name: BAR_PLUGIN.name, enabled: true, values: { level: 3 } })
      expect(bar?.fields.map((f) => f.key)).toEqual(['level'])
      expect(plugins.find((p) => p.id === STATUS_PLUGIN.id)).toMatchObject({ name: STATUS_PLUGIN.name, enabled: true, fields: [] })
    })

    it('puts an enabled plugin on a session\'s bar, and takes it off when the plugin is switched off', async () => {
      const items = await ctx.api.pluginBarRefresh(repoSession)
      expect(items).toEqual([{ ...BAR_ITEM, pluginId: BAR_PLUGIN.id }])
      expect(await ctx.api.pluginBarItems(repoSession)).toEqual(items)

      await ctx.api.settingsSet({ plugins: { [BAR_PLUGIN.id]: false } } as never)
      expect(ctx.heard.count('pluginsChanged')).toBeGreaterThan(0)
      expect((await ctx.api.pluginList()).find((p) => p.id === BAR_PLUGIN.id)?.enabled).toBe(false)
      expect((await ctx.api.settingsGet()).plugins[BAR_PLUGIN.id]).toBe(false)
      expect(await ctx.api.pluginBarRefresh(repoSession)).toEqual([])

      await ctx.api.settingsSet({ plugins: { [BAR_PLUGIN.id]: true } } as never)
      expect(await ctx.api.pluginBarRefresh(repoSession)).toHaveLength(1)
    })

    it('keeps a plugin\'s own settings, ignores a plugin it does not know, and falls back to the default for a value of the wrong type', async () => {
      await ctx.api.settingsSet({ pluginSettings: { [BAR_PLUGIN.id]: { level: 7 }, nobody: { level: 1 } } } as never)
      const settings = await ctx.api.settingsGet()
      expect(settings.pluginSettings[BAR_PLUGIN.id]).toEqual({ level: 7 })
      expect(settings.pluginSettings).not.toHaveProperty('nobody')
      expect((await ctx.api.pluginList()).find((p) => p.id === BAR_PLUGIN.id)?.values).toEqual({ level: 7 })

      await ctx.api.settingsSet({ pluginSettings: { [BAR_PLUGIN.id]: { level: 'high' } } } as never)
      expect((await ctx.api.pluginList()).find((p) => p.id === BAR_PLUGIN.id)?.values).toEqual({ level: 3 })
    })

    it('opens only web addresses when a plugin button is clicked', async () => {
      const click = (url: string): Promise<void> =>
        ctx.api.pluginRunAction({ ...BAR_ITEM, pluginId: BAR_PLUGIN.id, action: { kind: 'open-url', url } } satisfies PluginBarItem)
      await click('https://example.invalid/merge-request/1')
      await click('file:///etc/passwd')
      await click('not an address')
      await ctx.api.pluginRunAction({ ...BAR_ITEM, pluginId: BAR_PLUGIN.id, action: { kind: 'none' } })
      await click('http://example.invalid/two')
      expect(ctx.bridge.openedUrls()).toEqual(['https://example.invalid/merge-request/1', 'http://example.invalid/two'])
    })
  })

  describe('the status bar', () => {
    it('shows what each running plugin holds, labelled with the plugin it came from', async () => {
      expect(await ctx.api.statusBarItems()).toEqual([
        { ...STATUS_ITEM, pluginId: STATUS_PLUGIN.id },
        { ...CONSENT_ITEM, pluginId: CONSENT_PLUGIN.id },
      ])
    })

    it('answers a plugin\'s dashboard for its item, and nothing for a plugin that is off or unknown', async () => {
      expect(await ctx.api.statusBarPanel(STATUS_PLUGIN.id, STATUS_ITEM.id)).toEqual(STATUS_PANEL)
      expect(await ctx.api.statusBarPanel('nobody', STATUS_ITEM.id)).toBeNull()
      await ctx.api.settingsSet({ plugins: { [STATUS_PLUGIN.id]: false } } as never)
      expect(await ctx.api.statusBarPanel(STATUS_PLUGIN.id, STATUS_ITEM.id)).toBeNull()
    })

    it('drops a plugin\'s items when it is switched off, brings them back when it is on, and says so each time', async () => {
      const items = async (): Promise<string[]> => (await ctx.api.statusBarItems()).map((i) => i.pluginId)
      await ctx.api.settingsSet({ plugins: { [STATUS_PLUGIN.id]: false } } as never)
      expect(await items()).toEqual([CONSENT_PLUGIN.id])
      expect(ctx.heard.count('statusBarChanged')).toBe(1)
      await ctx.api.settingsSet({ plugins: { [STATUS_PLUGIN.id]: true } } as never)
      expect(await items()).toEqual([STATUS_PLUGIN.id, CONSENT_PLUGIN.id])
      expect(ctx.heard.count('statusBarChanged')).toBe(2)
    })

    it('a refresh of a running plugin tells views its items may have changed; one of a plugin that is off or unknown does nothing', async () => {
      await ctx.api.statusBarRefresh(STATUS_PLUGIN.id)
      expect(ctx.heard.count('statusBarChanged')).toBe(1)
      await ctx.api.statusBarRefresh('nobody')
      await ctx.api.settingsSet({ plugins: { [STATUS_PLUGIN.id]: false } } as never)
      ctx.heard.reset()
      await ctx.api.statusBarRefresh(STATUS_PLUGIN.id)
      expect(ctx.heard.count('statusBarChanged')).toBe(0)
    })

    it('an allowed question is gone from the bar and the plugin stays on', async () => {
      await ctx.api.statusBarConsent(CONSENT_PLUGIN.id, true)
      expect((await ctx.api.statusBarItems()).map((i) => i.pluginId)).toEqual([STATUS_PLUGIN.id])
      expect((await ctx.api.pluginList()).find((p) => p.id === CONSENT_PLUGIN.id)?.enabled).toBe(true)
      expect(ctx.heard.count('statusBarChanged')).toBe(1)
      expect(ctx.heard.count('pluginsChanged')).toBe(0)
    })

    it('a declined question switches the plugin off, and every view hears it', async () => {
      await ctx.api.statusBarConsent(CONSENT_PLUGIN.id, false)
      expect((await ctx.api.statusBarItems()).map((i) => i.pluginId)).toEqual([STATUS_PLUGIN.id])
      expect((await ctx.api.pluginList()).find((p) => p.id === CONSENT_PLUGIN.id)?.enabled).toBe(false)
      expect((await ctx.api.settingsGet()).plugins[CONSENT_PLUGIN.id]).toBe(false)
      expect(ctx.heard.count('statusBarChanged')).toBeGreaterThan(0)
      // A remote window hears the work machine's `pluginsChanged`, not home's own (events of `remote` scope).
      if (ctx.bridge.remote === undefined) expect(ctx.heard.count('pluginsChanged')).toBeGreaterThan(0)
    })

    it('an answer to a question nobody is asking is ignored, for an unknown plugin and for one with nothing to ask', async () => {
      const before = await ctx.api.pluginList()
      await ctx.api.statusBarConsent('no-such-plugin', false)
      await ctx.api.statusBarConsent(STATUS_PLUGIN.id, false)
      expect(await ctx.api.pluginList()).toEqual(before)
      expect(ctx.heard.count('statusBarChanged')).toBe(0)
    })
  })
}
