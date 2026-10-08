import { useCallback } from 'react'
import type { AppSettingsPayload } from '@shared/domain/settings'
import { SETTINGS, type SettingKey } from '@shared/settings/schema'
import { DEFAULT_SETTINGS_PAYLOAD } from '@shared/settingsDefaults'
import { createIpcStore } from './createIpcStore'

/**
 * Settings the renderer itself acts on, read fresh from main rather than kept in sync with it.
 *
 * These change only when someone changes them, and only from the Settings dialog — there is no
 * other writer, and no push from main when they change elsewhere (there is nowhere else). So a
 * read when the first reader arrives, plus `reload()` called when the dialog closes, is the whole
 * of it; a push subscription would be solving a problem this state doesn't have. Defaults are in
 * place until the read lands, and stay if it fails (the failure is logged).
 *
 * The mirror is every setting the schema declares (`shared/settings/schema.ts`), with its defaults
 * until the read lands. It used to be a hand-picked subset re-listed four times here (type,
 * defaults, equality, mapping), so a new setting the renderer reads needed edits in this file too —
 * the one-file schema recipe was quietly two files. Deriving it makes the schema the only list.
 */
export interface AppSettingsMirror extends AppSettingsPayload {
  /** Re-reads every field from main — call after the Settings dialog closes. */
  reload: () => void
}

const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[]

/** Same for rendering: every value equal, by value for the few that are objects (`plugins`). */
const sameSettings = (a: AppSettingsPayload, b: AppSettingsPayload): boolean =>
  SETTING_KEYS.every((k) => Object.is(a[k], b[k]) || JSON.stringify(a[k]) === JSON.stringify(b[k]))

const settingsStore = createIpcStore<AppSettingsPayload>({
  scope: 'settings',
  initial: DEFAULT_SETTINGS_PAYLOAD,
  equal: sameSettings,
  fetch: () => window.apiary.settingsGet(),
  // Nothing is pushed: see above.
  subscribe: () => () => undefined,
})

export function useAppSettings(): AppSettingsMirror {
  const fields = settingsStore.useStore()
  const reload = useCallback(() => { settingsStore.reload() }, [])
  return { ...fields, reload }
}

/** Every setting, as saved (the Settings dialog edits a draft of this). */
export const readSettings = (): Promise<AppSettingsPayload> => window.apiary.settingsGet()
/** Saves the draft; the dialog stays open and says why when it fails. */
export const saveSettingsDraft = (settings: AppSettingsPayload): Promise<void> => window.apiary.settingsSet(settings)
