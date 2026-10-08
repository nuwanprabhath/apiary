import type { PluginSettingField, PluginSettingValues } from '@shared/domain/plugins'
import type { StatusBarItem, StatusBarPanel } from '@shared/domain/statusBar'

/** What a status-bar plugin is handed when it starts. */
export interface StatusBarPluginContext {
  /** The plugin's settings as they are now, defaults filled in. */
  settings(): PluginSettingValues
  /** Tells every window the plugin's items changed. Cheap; call it whenever they do. */
  changed(): void
}

/**
 * A status-bar plugin. It owns its own schedule (a usage poll, say) between `start` and `stop`,
 * and answers `items()` from what it last learned — synchronously, so drawing the bar never waits
 * on the network. Everything it returns is data (see `@shared/domain/statusBar`).
 */
export interface StatusBarPlugin {
  id: string
  name: string
  description?: string
  defaultEnabled?: boolean
  settings?: PluginSettingField[]
  start(ctx: StatusBarPluginContext): void
  stop(): void
  items(): Omit<StatusBarItem, 'pluginId'>[]
  /** Refresh now, for the refresh item and the dashboard's button. */
  refresh(): Promise<void>
  /** The dashboard behind an item whose action is `panel`. */
  panel?(itemId: string): Promise<StatusBarPanel | null>
  /** Settings changed while running. Default: stop, then start again. */
  settingsChanged?(): void
  /**
   * The user's answer to the consent prompt this plugin's item carries (`action.kind === 'consent'`).
   * A plugin that has nothing to ask leaves this out.
   */
  answerConsent?(allow: boolean): void
}
