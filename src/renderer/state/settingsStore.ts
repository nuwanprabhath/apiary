import { useCallback } from 'react'
import type { AppSettingsPayload } from '@shared/domain/settings'
import { SETTINGS, type SettingKey } from '@shared/settings/schema'
import { DEFAULT_SETTINGS_PAYLOAD } from '@shared/settingsDefaults'
import type { LibraryState } from '@shared/libraryState'
import { createIpcStore } from './createIpcStore'
import { readLibraryState, saveLibraryState } from './libraryStateStore'

/**
 * Settings the renderer itself acts on: every setting the schema declares (`shared/settings/schema.ts`).
 *
 * Only the Settings dialog writes them and main pushes nothing, so a read when the first reader
 * arrives plus `reload()` when the dialog closes is the whole of it. Defaults stand until the read
 * lands, and stay if it fails (the failure is logged).
 */
export interface AppSettingsMirror extends AppSettingsPayload {
  /** Re-reads every field from main — call after the Settings dialog closes. */
  reload: () => void
}

const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[]

/** Every value equal, by value for the few that are objects (`plugins`). */
const sameSettings = (a: AppSettingsPayload, b: AppSettingsPayload): boolean =>
  SETTING_KEYS.every((k) => Object.is(a[k], b[k]) || JSON.stringify(a[k]) === JSON.stringify(b[k]))

const settingsStore = createIpcStore<AppSettingsPayload>({
  scope: 'settings',
  initial: DEFAULT_SETTINGS_PAYLOAD,
  equal: sameSettings,
  fetch: () => window.apiary.settingsGet(),
  subscribe: () => () => undefined,
})

export function useAppSettings(): AppSettingsMirror {
  const fields = settingsStore.useStore()
  const reload = useCallback(() => { settingsStore.reload() }, [])
  return { ...fields, reload }
}

/**
 * What the Settings dialog edits: every setting, plus the library preferences it has a control
 * for. Those are library state (`shared/libraryState.ts`), so in a remote window the dialog edits
 * the work machine's, while the settings themselves stay this machine's.
 */
export type SettingsDraft = AppSettingsPayload & Pick<LibraryState, 'hideToolCallIo'>

/** Every setting, as saved, and the library preferences the dialog shows. */
export const readSettings = async (): Promise<SettingsDraft> => {
  const [settings, library] = await Promise.all([window.apiary.settingsGet(), readLibraryState()])
  return { ...settings, hideToolCallIo: library.hideToolCallIo }
}
/** Saves the draft; the dialog stays open and says why when it fails. The library preference is
 *  sent only when it changed, so opening and saving the dialog leaves library state alone. `motion`
 *  is sent as saved now: its control saves it at once, and the draft still holds what it was when
 *  the dialog opened. */
export const saveSettingsDraft = async ({ hideToolCallIo, ...settings }: SettingsDraft): Promise<void> => {
  await window.apiary.settingsSet({ ...settings, motion: (await window.apiary.settingsGet()).motion })
  if (hideToolCallIo !== (await readLibraryState()).hideToolCallIo) await saveLibraryState({ hideToolCallIo })
}

/** Saves the animations setting at once (it has no Save button, like the theme options) and re-reads. */
export const saveMotionSetting = async (motion: AppSettingsPayload['motion']): Promise<void> => {
  await window.apiary.settingsSet({ ...(await window.apiary.settingsGet()), motion })
  settingsStore.reload()
}
