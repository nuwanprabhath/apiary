import type { PetPatch, PetPlace, PetRecord, PetsState } from '@shared/pets/state'
import type { VoiceContext } from '@shared/pets/prompt'
import { createIpcStore } from './createIpcStore'
import { currentActiveTabs } from './activeTabsStore'
import { background, bestEffort, surface } from './policy'

/** The pets as main has them, kept current by `petsChanged`; null until the first answer. One
 *  subscription however many places read it (the layer, the Settings section). */
const petsStore = createIpcStore<PetsState | null>({
  scope: 'app',
  initial: null,
  fetch: () => window.apiary.petsState(),
  subscribe: (push) => window.apiary.onPetsChanged(push),
})

export function usePets(): PetsState | null {
  return petsStore.useStore()
}

// -- Commands. Settings → Pets awaits these and shows a failure inline (policy 3); the pet layer's
// -- are fire-and-forget on a gesture, so they follow policy 1 or 2 (state/policy.ts).

export const setPetsEnabled = (on: boolean): Promise<void> => window.apiary.petsSetEnabled(on)
export const generatePet = (description: string | null, model: string | null): Promise<PetRecord> =>
  window.apiary.petGenerate(description, model)
export function cancelPetGeneration(): void { window.apiary.petGenerateCancel() }
export const updatePet = (id: string, patch: PetPatch): Promise<PetRecord> => window.apiary.petUpdate(id, patch)
export const deletePet = (id: string): Promise<void> => window.apiary.petDelete(id)
export const exportPet = (id: string): Promise<boolean> => window.apiary.petExport(id)
export const importPet = (): Promise<PetRecord | null> => window.apiary.petImport()
export const chatWithPet = (id: string, text: string): Promise<string> => window.apiary.petChat(id, text)

/** A pet was dropped somewhere: remember the spot. The pet already stands there on screen, so a
 *  failed save only costs the position across a restart: logged, not shown. */
export function rememberPetPlace(id: string, place: PetPlace): void {
  background(window.apiary.petUpdate(id, { place }), 'app')
}

/** Resize or put away from the pet's menu: nothing changes on screen unless it worked. */
export function resizePet(id: string, size: number): void {
  surface(window.apiary.petUpdate(id, { size }), 'Could not resize the pet')
}
export function putPetAway(id: string): void {
  surface(window.apiary.petUpdate(id, { active: false }), 'Could not put the pet away')
}

/** What a pet makes of Claude's latest action; null when it has nothing to say or the call failed. */
export const petRemark = (id: string, action: string): Promise<string | null> =>
  bestEffort(window.apiary.petComment(id, action), 'app')
// -- What Claude is doing, for the pets' remarks. Main reads it from the end of a session's
// -- transcript on request; it does not push it, but it does push every change of the tabs'
// -- activity (`activeTabsChanged`) and of the sessions (`treeChanged`). Those pushes are the
// -- signal to ask again, so nothing polls.

/** The most often the actions are re-read while pushes keep coming. A remark is at most one every
 *  3 minutes, so a couple of seconds of lag is invisible. */
const ACTIONS_SETTLE_MS = 2_000

const sameActions = (a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>): boolean =>
  a.size === b.size && [...a].every(([key, action]) => b.get(key) === action)

const claudeActionsStore = createIpcStore<ReadonlyMap<string, string>>({
  scope: 'app',
  initial: new Map(),
  equal: sameActions,
  fetch: async () => {
    const running = (await currentActiveTabs()).filter((t) => t.status === 'running').map((t) => t.key)
    if (running.length === 0) return new Map()
    return new Map((await window.apiary.petClaudeActions(running)).map((a) => [a.key, a.action]))
  },
  subscribe: (_push, invalidate) => {
    const soon = settle(invalidate, ACTIONS_SETTLE_MS)
    const offs = [window.apiary.onActiveTabsChanged(soon.run), window.apiary.onTreeChanged(soon.run)]
    return () => { for (const off of offs) off(); soon.cancel() }
  },
})

/** Runs `fn` now, then at most once per `ms` while `run` keeps being called (the last call is kept). */
function settle(fn: () => void, ms: number): { run: () => void; cancel: () => void } {
  let last = -Infinity
  let timer: number | null = null
  const fire = (): void => { timer = null; last = Date.now(); fn() }
  return {
    run: () => {
      if (timer !== null) return
      const wait = last + ms - Date.now()
      if (wait <= 0) fire()
      else timer = window.setTimeout(fire, wait)
    },
    cancel: () => { if (timer !== null) window.clearTimeout(timer); timer = null },
  }
}

/** Keeps the working sessions' latest actions current for as long as it is held (call the result
 *  to stop). Read them with `latestClaudeAction`. */
export function watchClaudeActions(): () => void {
  return claudeActionsStore.subscribe(() => {})
}

/** What one working session is doing, or undefined when none is. */
export function latestClaudeAction(): string | undefined {
  return claudeActionsStore.getSnapshot().values().next().value
}

// -- The hourly "are any lines due" check: one timer for the window, however many layers listen.

const VOICE_CHECK_MS = 10 * 60_000
const VOICE_FIRST_MS = 30_000
const voiceListeners = new Set<() => void>()
let voiceTimers: { first: number; every: number } | null = null

/** Calls `due` shortly after the first listener arrives and every ten minutes after that. */
export function onPetVoiceCheck(due: () => void): () => void {
  voiceListeners.add(due)
  const tell = (): void => { for (const l of voiceListeners) l() }
  voiceTimers ??= { first: window.setTimeout(tell, VOICE_FIRST_MS), every: window.setInterval(tell, VOICE_CHECK_MS) }
  return () => {
    voiceListeners.delete(due)
    if (voiceListeners.size > 0 || voiceTimers === null) return
    window.clearTimeout(voiceTimers.first)
    window.clearInterval(voiceTimers.every)
    voiceTimers = null
  }
}

/** Asks main whether a pet is due fresh lines; best effort, the next check tries again. */
export function askPetVoice(id: string, context: VoiceContext): Promise<boolean | null> {
  return bestEffort(window.apiary.petVoice(id, context), 'app')
}
