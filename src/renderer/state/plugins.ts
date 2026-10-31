import type { TerminalRef } from '@shared/domain/ids'
import type { PluginBarItem } from '@shared/domain/plugins'
import { bestEffort, surface } from './policy'

/** Session-bar plugins (merge-request buttons and the like). Settings lists them with `listSettingsPlugins` (`settingsStore.ts`). */

/** The buttons for a tab; null when they could not be read. Nothing here is load-bearing, so a
 *  bar that cannot be read is an empty bar, never an error in front of the session. */
export const readPluginBar = (terminal: TerminalRef): Promise<PluginBarItem[] | null> =>
  bestEffort(window.apiary.pluginBarItems(terminal), 'app')
export const refreshPluginBar = (terminal: TerminalRef): Promise<PluginBarItem[] | null> =>
  bestEffort(window.apiary.pluginBarRefresh(terminal), 'app')

/** A plugin button was clicked: its action runs in main, and a failure is shown. */
export function runPluginAction(item: PluginBarItem): void {
  surface(window.apiary.pluginRunAction(item), `Could not run ${item.label === '' ? item.title : item.label}`)
}

/** Main saw plugin data change. */
export const onPluginsChanged = (cb: () => void): (() => void) => window.apiary.onPluginsChanged(cb)
