/**
 * The renderer-facing settings type. It is derived from the schema (`shared/settings/schema.ts`),
 * which is where a setting is declared; this re-export keeps the import path callers already use.
 */
export type { AppSettingsPayload } from '../settings/schema'
