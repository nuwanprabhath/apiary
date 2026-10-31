import { useCallback } from 'react'
import type { AppSettingsPayload } from '@shared/domain/settings'
import type { PluginInfoPayload } from '@shared/domain/plugins'
import {
  INSTANT_SETTINGS, SCREEN_SETTING_KEYS, SETTINGS, machinePayload, type InstantSettingKey, type SettingKey,
} from '@shared/settings/schema'
import { DEFAULT_SETTINGS_PAYLOAD } from '@shared/settingsDefaults'
import type { LibraryState } from '@shared/libraryState'
import { createIpcStore } from './createIpcStore'
import { createLocalStore } from './createLocalStore'
import { readLibraryState, saveLibraryState } from './libraryStateStore'
import { bestEffort } from './policy'
import { remoteHost } from './windowParams'

/**
 * Settings the renderer itself acts on: every setting the schema declares (`shared/settings/schema.ts`).
 *
 * Only the Settings dialog writes them, so a read when the first reader arrives plus `reload()` when
 * the dialog closes is most of it. In a remote window the `machine` keys are the work machine's,
 * laid over this machine's `screen` keys, and re-read when the work machine says they changed.
 * Defaults stand until the read lands, and stay if it fails (the failure is logged).
 */
export interface AppSettingsMirror extends AppSettingsPayload {
  /** Re-reads every field from main — call after the Settings dialog closes. */
  reload: () => void
}

const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[]

/** Every value equal, by value for the few that are objects (`plugins`). */
const sameSettings = (a: AppSettingsPayload, b: AppSettingsPayload): boolean =>
  SETTING_KEYS.every((k) => Object.is(a[k], b[k]) || JSON.stringify(a[k]) === JSON.stringify(b[k]))

/** This machine's settings with the `machine` keys of the machine the window shows laid over them. */
const readWindowSettings = async (): Promise<AppSettingsPayload> => {
  if (remoteHost() === null) return window.apiary.settingsGet()
  const [local, machine] = await Promise.all([window.apiary.settingsGet(), window.apiary.machineSettingsGet()])
  return { ...local, ...machine }
}

const settingsStore = createIpcStore<AppSettingsPayload>({
  scope: 'settings',
  initial: DEFAULT_SETTINGS_PAYLOAD,
  equal: sameSettings,
  fetch: readWindowSettings,
  subscribe: (_push, invalidate) => (remoteHost() === null ? () => undefined : window.apiary.onMachineSettingsChanged(invalidate)),
})

export function useAppSettings(): AppSettingsMirror {
  const fields = settingsStore.useStore()
  const reload = useCallback(() => { settingsStore.reload() }, [])
  return { ...fields, reload }
}

/**
 * Which machine the Settings dialog edits. `machine` is the one the window shows; `this` is the
 * machine Apiary runs on. They differ only in a remote window, where the dialog opens on the work
 * machine and its switch picks This Mac. Per window; back to `machine` whenever the dialog closes,
 * so a resident's or the status bar's "Settings…" opens on the machine they belong to.
 */
export type SettingsTarget = 'machine' | 'this'
const target = createLocalStore<{ target: SettingsTarget }>({ target: 'machine' })

export const useSettingsTarget = (): SettingsTarget => target.useStore().target
export const setSettingsTarget = (next: SettingsTarget): void => { target.set({ target: next }) }

/** True when writes go to the work machine: a remote window whose dialog is on its machine view. */
const onWorkMachine = (): boolean => remoteHost() !== null && target.get().target === 'machine'

/** What this machine is called in the switch: the platform's own word for it. */
export const thisComputerName = (): string => (navigator.userAgent.includes('Mac') ? 'This Mac' : 'This computer')

/**
 * What the Settings dialog edits: every setting, plus the library preferences it has a control
 * for. Those are library state (`shared/libraryState.ts`), so in a remote window the dialog edits
 * the work machine's. On the work machine's view the `machine` keys are the work machine's.
 */
export type SettingsDraft = AppSettingsPayload & Pick<LibraryState, 'hideToolCallIo'>

/** Every setting as saved on the dialog's machine (the `screen` keys always this machine's). */
const readSaved = async (): Promise<AppSettingsPayload> => {
  const local = await window.apiary.settingsGet()
  return onWorkMachine() ? { ...local, ...(await window.apiary.machineSettingsGet()) } : local
}

/** Every setting, as saved, and the library preferences the dialog shows. */
export const readSettings = async (): Promise<SettingsDraft> => {
  const [settings, library] = await Promise.all([readSaved(), readLibraryState()])
  return { ...settings, hideToolCallIo: library.hideToolCallIo }
}

/** The plugins Settings → Plugins lists: the work machine's on its view, else this machine's. None when main could not say. */
export const listSettingsPlugins = (): Promise<PluginInfoPayload[]> =>
  bestEffort(onWorkMachine() ? window.apiary.machinePluginList() : window.apiary.pluginList(), 'app').then((list) => list ?? [])

/** Saves the draft; the dialog stays open and says why when it fails. The library preference is
 *  sent only when it changed, so opening and saving the dialog leaves library state alone. The
 *  `INSTANT_SETTINGS` are sent as saved now: their controls save them at once, and the draft still
 *  holds what they were when the dialog opened. On the work machine's view only its `machine` keys
 *  are sent, to its `machineSettingsSet`, and never `remoteAccess`. */
export const saveSettingsDraft = async ({ hideToolCallIo, ...settings }: SettingsDraft): Promise<void> => {
  const saved = await readSaved()
  const instant = Object.fromEntries(INSTANT_SETTINGS.map((k) => [k, saved[k]])) as Pick<AppSettingsPayload, InstantSettingKey>
  if (onWorkMachine()) {
    // Remote access is never switched from a window that runs over it (General shows it read-only).
    const { remoteAccess: _unchanged, ...machine } = machinePayload({ ...settings, ...instant })
    await window.apiary.machineSettingsSet(machine)
  }
  else await window.apiary.settingsSet({ ...settings, ...instant })
  if (hideToolCallIo !== (await readLibraryState()).hideToolCallIo) await saveLibraryState({ hideToolCallIo })
}

/** Re-reads the settings after a command outside the dialog changed them (`addResident`, `updateResident`). */
export const reloadSettings = (): void => { settingsStore.reload() }

/** Every setting as saved where an instant setting of the window's machine goes: what `updateResident` edits. */
export const readSavedSettings = (): Promise<AppSettingsPayload> => readSaved()

/**
 * Saves one of the `INSTANT_SETTINGS` at once (it has no Save button, like the theme options) and
 * re-reads. A `machine` key (`residents`) goes to the work machine on its view; a `screen` key
 * (`motion`) is always this machine's.
 */
export const saveInstantSetting = async (patch: Partial<Pick<AppSettingsPayload, InstantSettingKey>>): Promise<void> => {
  const keys = Object.keys(patch) as InstantSettingKey[]
  const toWorkMachine = onWorkMachine() && keys.every((k) => !SCREEN_SETTING_KEYS.has(k))
  if (toWorkMachine) await window.apiary.machineSettingsSet(patch)
  else await window.apiary.settingsSet({ ...(await window.apiary.settingsGet()), ...patch })
  settingsStore.reload()
}
