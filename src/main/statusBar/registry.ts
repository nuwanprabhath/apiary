import type { PluginSettingValues } from '@shared/domain/plugins'
import type { StatusBarItem, StatusBarPanel } from '@shared/domain/statusBar'
import { withDefaults } from '../plugins/types'
import { log } from '../log/logger'
import type { StatusBarPlugin } from './types'

/**
 * The status-bar plugins and their lifecycle. The same two guarantees as the session-bar registry
 * (src/main/plugins/CLAUDE.md): a plugin that throws contributes nothing and disturbs nothing else,
 * and nothing it does is on the render path — `items()` is answered from what each plugin already
 * holds. Enabled plugins run; switching one off stops it and its items go.
 *
 * It shares the Plugins section of Settings with the session-bar plugins: `list()` has the same
 * shape, and settings are namespaced under the same `pluginSettings[pluginId]`.
 */
export class StatusBarRegistry {
  private readonly plugins: StatusBarPlugin[] = []
  private readonly enabled = new Map<string, boolean>()
  private readonly settings = new Map<string, PluginSettingValues>()
  private readonly running = new Set<string>()
  private readonly onChanged: () => void

  constructor(options: { onChanged?: () => void } = {}) {
    this.onChanged = options.onChanged ?? (() => {})
  }

  register(plugin: StatusBarPlugin, enabled: boolean): void {
    this.plugins.push(plugin)
    this.enabled.set(plugin.id, enabled)
  }

  has(pluginId: string): boolean {
    return this.plugins.some((p) => p.id === pluginId)
  }

  /** Starts every enabled plugin. Separate from the constructor so tests and startup choose when. */
  start(): void {
    for (const p of this.plugins) if (this.isEnabled(p.id)) this.startOne(p)
  }

  stop(): void {
    for (const p of this.plugins) this.stopOne(p)
  }

  setEnabled(pluginId: string, enabled: boolean): void {
    const plugin = this.plugins.find((p) => p.id === pluginId)
    if (plugin === undefined || this.isEnabled(pluginId) === enabled) return
    this.enabled.set(pluginId, enabled)
    if (enabled) this.startOne(plugin)
    else this.stopOne(plugin)
    this.onChanged()
  }

  setSettings(pluginId: string, values: PluginSettingValues): void {
    if (JSON.stringify(this.settings.get(pluginId) ?? {}) === JSON.stringify(values)) return
    this.settings.set(pluginId, values)
    const plugin = this.plugins.find((p) => p.id === pluginId)
    if (plugin === undefined || !this.running.has(pluginId)) return
    try {
      if (plugin.settingsChanged !== undefined) plugin.settingsChanged()
      else { this.stopOne(plugin); this.startOne(plugin) }
    } catch (e) {
      this.fail(plugin, 'settings', e)
    }
    this.onChanged()
  }

  isEnabled(pluginId: string): boolean {
    return this.enabled.get(pluginId) ?? false
  }

  settingsFor(pluginId: string): PluginSettingValues {
    const plugin = this.plugins.find((p) => p.id === pluginId)
    return withDefaults(plugin?.settings ?? [], this.settings.get(pluginId))
  }

  list(): { id: string; name: string; description: string | null; enabled: boolean; fields: NonNullable<StatusBarPlugin['settings']>; values: PluginSettingValues }[] {
    return this.plugins.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description ?? null,
      enabled: this.isEnabled(p.id),
      fields: p.settings ?? [],
      values: this.settingsFor(p.id),
    }))
  }

  items(): StatusBarItem[] {
    const out: StatusBarItem[] = []
    for (const p of this.plugins) {
      if (!this.running.has(p.id)) continue
      try {
        for (const item of p.items()) out.push({ ...item, pluginId: p.id })
      } catch (e) {
        this.fail(p, 'items', e)
      }
    }
    return out
  }

  async refresh(pluginId: string): Promise<void> {
    const plugin = this.runningPlugin(pluginId)
    if (plugin === null) return
    try {
      await plugin.refresh()
    } catch (e) {
      this.fail(plugin, 'refresh', e)
    }
  }

  async panel(pluginId: string, itemId: string): Promise<StatusBarPanel | null> {
    const plugin = this.runningPlugin(pluginId)
    if (plugin?.panel === undefined) return null
    try {
      return await plugin.panel(itemId)
    } catch (e) {
      this.fail(plugin, 'panel', e)
      return null
    }
  }

  private runningPlugin(pluginId: string): StatusBarPlugin | null {
    if (!this.running.has(pluginId)) return null
    return this.plugins.find((p) => p.id === pluginId) ?? null
  }

  private startOne(plugin: StatusBarPlugin): void {
    if (this.running.has(plugin.id)) return
    try {
      plugin.start({ settings: () => this.settingsFor(plugin.id), changed: () => { this.onChanged() } })
      this.running.add(plugin.id)
    } catch (e) {
      this.fail(plugin, 'start', e)
    }
  }

  private stopOne(plugin: StatusBarPlugin): void {
    if (!this.running.delete(plugin.id)) return
    try { plugin.stop() } catch (e) { this.fail(plugin, 'stop', e) }
  }

  private fail(plugin: StatusBarPlugin, what: string, e: unknown): void {
    log.warn('status-bar', 'plugin failed', { plugin: plugin.id, what, error: e instanceof Error ? e.message : String(e) })
  }
}
