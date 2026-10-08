import { IPC, type AppSettingsPayload } from '@shared/api'
import { pickPayload } from '@shared/settings/schema'
import type { AppService } from '../../appService'
import type { PluginService } from '../../plugins/pluginService'
import type { UpdateService } from '../../update/updateService'
import type { SettingsService } from '../../settings/settingsService'
import { configureLogging } from '../../log/configure'
import { log } from '../../log/logger'
import { broadcast } from '../../windows/broadcast'
import type { Handlers } from '../registrar'

export interface SettingsDeps {
  service: AppService
  plugins: PluginService
  settings: SettingsService
  updater?: UpdateService | null
  onAutoImportIntervalChange?: (intervalMinutes: number | null) => void
}

type HandledKeys = 'settingsGet' | 'settingsSet'

export function settingsHandlers(deps: SettingsDeps): Pick<Handlers, HandledKeys> {
  const { service, plugins, settings: settingsService, updater, onAutoImportIntervalChange } = deps

  return {
    settingsGet: (): AppSettingsPayload => {
      const settings = settingsService.get()
      return {
        ...pickPayload(settings),
        // The two fields the plugins own: what is on, and each plugin's values, come from the
        // plugin registry rather than from settings.json.
        plugins: Object.fromEntries(plugins.list().map((p) => [p.id, p.enabled])),
        pluginSettings: Object.fromEntries(plugins.list().map((p) => [p.id, p.values])),
      }
    },
    settingsSet: async (_e, next) => {
      const current = settingsService.get()
      // See `mergeSettingsPayload` (src/main/settings.ts) for why a missing field must mean "leave
      // it alone", never "off" (the bug that made session notes stop being indexed), and for the
      // SEC-8 validation on claudeBin, the numeric fields and pluginSettings.
      const knownPluginIds = new Set(plugins.list().map((p) => p.id))
      const merged = settingsService.applyPayload(next, knownPluginIds)
      // The schedule has to follow the settings immediately: switching checks off and having one
      // fire ten minutes later is the kind of thing that makes a toggle look broken.
      updater?.settingsChanged()
      service.setClaudeBin(merged.claudeBin)
      service.setAutoImportAll(merged.autoImportAll)
      service.setSearchChatContent(merged.searchChatContent)
      service.setSearchSessionNotes(merged.searchSessionNotes)
      for (const [id, enabled] of Object.entries(merged.plugins)) {
        plugins.setEnabled(id, enabled)
      }
      for (const [id, values] of Object.entries(merged.pluginSettings)) {
        plugins.setSettings(id, values)
      }
      // Switching a plugin off changes what every open bar should show, and nothing else would
      // tell the windows: the bar only re-reads on a branch change or on this signal.
      broadcast(IPC.pluginsChanged)
      service.setPromptPath({
        enabled: merged.terminalShortenPath,
        segments: merged.terminalPathSegments,
        minimal: merged.terminalMinimalPrompt,
      })
      // Applied immediately: switching diagnostics off has to stop writing now, not at next
      // launch, or "off" is a promise the app keeps only eventually.
      configureLogging(merged)
      log.info('settings', 'settings saved', {
        diagnosticsEnabled: merged.diagnosticsEnabled,
        terminalShortenPath: merged.terminalShortenPath,
        terminalPathSegments: merged.terminalPathSegments,
        terminalMinimalPrompt: merged.terminalMinimalPrompt,
      })
      // Switching content search on should not mean waiting until the next rescan to be able to
      // use it, so the first pass starts now; it is a background chore either way.
      if (merged.searchChatContent) void service.updateSearchIndex()
      onAutoImportIntervalChange?.(merged.autoImportIntervalMinutes)
      // If autoImportAll was just switched ON, import everything right away.
      if (merged.autoImportAll && !current.autoImportAll) {
        await service.importAllDiscovered()
        broadcast(IPC.treeChanged)
      }
    },
  }
}
