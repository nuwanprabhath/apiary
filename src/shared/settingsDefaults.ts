import type { AppSettingsPayload } from './api'

/**
 * The default value of every setting the renderer can read or write, shared by
 * `src/main/settings.ts` (which adds its own main-only fields — `schemaVersion`,
 * `updateSkippedVersion`, `windowBounds`) and `tests/component/fakeApiary.ts`.
 *
 * Kept here rather than duplicated in both places: `AppSettingsPayload`'s fields already have to
 * change in `shared/ipc/contract.ts` and `main/ipc/handlers/settings.ts`, and a further hand-copy
 * of every default value is exactly the kind of place a component test quietly drifts from what
 * main actually ships — see TEST-5.
 */
export const DEFAULT_SETTINGS_PAYLOAD: AppSettingsPayload = {
  claudeBin: null,
  autoImportAll: false,
  autoImportIntervalMinutes: null,
  revealActiveInSidebar: true,
  systemTitleBar: false,
  searchChatContent: true,
  searchSessionNotes: true,
  recentSectionEnabled: true,
  recentSectionHours: 24,
  terminalShortenPath: true,
  terminalPathSegments: 1,
  terminalMinimalPrompt: true,
  plugins: {},
  pluginSettings: {},
  updateAutomaticChecks: true,
  updateCheckIntervalHours: 6,
  updateAutoDownload: false,
  updateAllowPrerelease: false,
  diagnosticsEnabled: false,
  logRetentionDays: 7,
  logMaxSizeMb: 20,
}
