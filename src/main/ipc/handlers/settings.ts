import { IPC, type AppSettingsPayload } from '@shared/api'
import { machinePayload, pickPayload } from '@shared/settings/schema'
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
  updater: UpdateService | null
  onAutoImportIntervalChange: ((intervalMinutes: number | null) => void) | null
}

type HandledKeys = 'settingsGet' | 'settingsSet' | 'machineSettingsGet' | 'machineSettingsSet'

export function settingsHandlers(deps: SettingsDeps): Pick<Handlers, HandledKeys> {
  const { service, plugins, settings: settingsService, updater, onAutoImportIntervalChange } = deps

  const read = (): AppSettingsPayload => ({
    ...pickPayload(settingsService.get()),
    // Owned by the plugin registry, not settings.json.
    plugins: Object.fromEntries(plugins.list().map((p) => [p.id, p.enabled])),
    pluginSettings: Object.fromEntries(plugins.list().map((p) => [p.id, p.values])),
  })

  const apply = async (next: Partial<AppSettingsPayload>): Promise<void> => {
    const current = settingsService.get()
    // See `mergeSettingsPayload` (src/main/settings.ts) for why a missing field must mean "leave
    // it alone", never "off", and for the validation on claudeBin, numbers and pluginSettings.
    const knownPluginIds = new Set(plugins.list().map((p) => p.id))
    const merged = settingsService.applyPayload(next, knownPluginIds)
    // The update schedule follows the settings immediately, or a toggle looks broken.
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
    // The bar only re-reads on a branch change or on this signal.
    broadcast(IPC.pluginsChanged)
    // A Settings dialog open on this machine from a remote window re-reads.
    broadcast(IPC.machineSettingsChanged)
    service.setPromptPath({
      enabled: merged.terminalShortenPath,
      segments: merged.terminalPathSegments,
      minimal: merged.terminalMinimalPrompt,
    })
    // Switching diagnostics off stops writing now, not at next launch.
    configureLogging(merged)
    log.info('settings', 'settings saved', {
      diagnosticsEnabled: merged.diagnosticsEnabled,
      terminalShortenPath: merged.terminalShortenPath,
      terminalPathSegments: merged.terminalPathSegments,
      terminalMinimalPrompt: merged.terminalMinimalPrompt,
    })
    // The first indexing pass starts now rather than at the next rescan.
    if (merged.searchChatContent) void service.updateSearchIndex()
    onAutoImportIntervalChange?.(merged.autoImportIntervalMinutes)
    if (merged.autoImportAll && !current.autoImportAll) {
      await service.importAllDiscovered()
      broadcast(IPC.treeChanged)
    }
  }

  return {
    settingsGet: read,
    settingsSet: (_e, next) => apply(next),
    machineSettingsGet: () => machinePayload(read()),
    // The contract's guard has refused any `screen` key; each value is validated by
    // `mergeSettingsPayload`, as for `settingsSet`.
    machineSettingsSet: (_e, patch) => apply(patch),
  }
}
