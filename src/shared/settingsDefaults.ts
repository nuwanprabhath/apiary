import { type AppSettingsPayload, settingsDefaults } from './settings/schema'

/**
 * The default value of every setting the renderer can read or write, derived from the schema
 * (`shared/settings/schema.ts`). Shared by `src/main/settings.ts` (which adds its own main-only
 * fields — `schemaVersion`, `updateSkippedVersion`, `windowBounds`) and
 * `tests/component/fakeApiary.ts`, so a component test cannot drift from what main ships (TEST-5).
 */
export const DEFAULT_SETTINGS_PAYLOAD: AppSettingsPayload = settingsDefaults()
