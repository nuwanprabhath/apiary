import type { ResidentConfig, ResidentKindId, ResidentKindInfo } from '@shared/domain/residents'
import { createIpcStore } from './createIpcStore'
import { createLocalStore } from './createLocalStore'
import { surface } from './policy'
import { readSavedSettings, reloadSettings, saveInstantSetting } from './settingsStore'

/** Turns a resident on or off from outside Settings (the badge's right-click menu). Failure is surfaced. */
export function setResidentEnabled(id: string, enabled: boolean): void {
  surface(updateResident(id, { enabled }), enabled ? 'Could not turn the resident on' : 'Could not turn the resident off')
}

/**
 * The resident whose Settings card should be scrolled into view and highlighted when Settings →
 * Residents next shows it (the badge's "Settings…"). Per window, taken once by the card.
 */
const revealed = createLocalStore<{ id: string | null }>({ id: null })

/** Asks Settings → Residents to scroll to and highlight this resident's card. */
export function revealResidentCard(id: string): void {
  revealed.set({ id })
}

/** The resident whose card is waiting to be revealed, or null. */
export function useRevealedResidentCard(): string | null {
  return revealed.useStore().id
}

/** The card has been revealed: forget the request, so reopening Settings does not do it again. */
export function clearRevealedResidentCard(): void {
  revealed.set({ id: null })
}

/**
 * Adds a resident of `kind` with the kind's defaults (switched off) and resolves with its config.
 * Returned policy: the Settings section awaits it to open the new card, and shows a failure inline.
 */
export async function addResident(kind: ResidentKindId): Promise<ResidentConfig> {
  const added = await window.apiary.residentsAdd(kind)
  reloadSettings()
  return added
}

/**
 * Changes one resident's settings (name, enabled, models, schedule, usage pause, permission mode,
 * digest lookback, a text option in `options`) at once, as an instant setting: main's constraint
 * applies (a name trimmed to 40 characters, days made unique), the resident service follows, and
 * the Settings dialog's Save leaves the list as saved rather than putting back the one it read when
 * it opened. A folder option is never written here: use `pickResidentFolder`. Returned policy: the
 * card awaits it and shows a failure inline.
 */
export async function updateResident(id: string, patch: Partial<Omit<ResidentConfig, 'id' | 'kind'>>): Promise<void> {
  const saved = await readSavedSettings()
  if (!saved.residents.some((c) => c.id === id)) throw new Error(`No resident ${id}`)
  const residents = saved.residents.map((c) => (c.id === id ? { ...c, ...patch, id: c.id, kind: c.kind } : c))
  await saveInstantSetting({ residents })
}

/**
 * Opens main's folder dialog for one of the kind's `input: 'folder'` option fields; main stores the
 * chosen folder in the resident's `options` itself (the renderer never supplies the path). Resolves
 * with the stored value for display, or null when the dialog was cancelled. Returned policy: the
 * field awaits it and shows a failure inline.
 */
export async function pickResidentFolder(id: string, key: string): Promise<string | null> {
  const picked = await window.apiary.residentPickFolder(id, key)
  if (picked !== null) reloadSettings()
  return picked
}

/**
 * A remote window's stand-in for `pickResidentFolder`: stores the folder the in-app browse `browseId`
 * shows on the work machine (`folderBrowse*`), which resolves it there. Returned policy, as above.
 */
export async function setResidentFolderFromBrowse(id: string, key: string, browseId: string): Promise<string> {
  const stored = await window.apiary.residentUseBrowsedFolder(id, key, browseId)
  reloadSettings()
  return stored
}

/**
 * Every resident kind (`ResidentKindInfo`: name, blurb, option fields, whether it digests, its
 * look), for "Add …" and a card's option fields. Kinds are fixed while Apiary runs, so it is read
 * once and nothing pushes it. `[]` until the answer comes.
 */
const kindsStore = createIpcStore<ResidentKindInfo[]>({
  scope: 'residents',
  initial: [],
  fetch: () => window.apiary.residentKinds(),
  subscribe: () => () => {},
})

/** Every resident kind, in the order main declares them. */
export function useResidentKinds(): ResidentKindInfo[] {
  return kindsStore.useStore()
}
