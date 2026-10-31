import type { ResidentStatus } from '@shared/domain/residents'
import { createIpcStore } from './createIpcStore'

/**
 * Every resident agent's status (`ResidentStatus`: state, activity, schedule, appearance, digest
 * progress), read from main and re-read on each `residentsChanged`. One subscription and one
 * in-flight fetch however many components read it (see createIpcStore.ts). `[]` until the first
 * answer; `useResidentsLoaded` says whether it has come.
 */
const residentsStore = createIpcStore<ResidentStatus[]>({
  scope: 'residents',
  initial: [],
  fetch: () => window.apiary.residentsList(),
  subscribe: (push) => window.apiary.onResidentsChanged(push),
})

/** Every resident's status, in the order of the `residents` setting. */
export function useResidents(): ResidentStatus[] {
  return residentsStore.useStore()
}

/** One resident's status, or null when there is no resident with that id (yet, or any more). */
export function useResident(id: string): ResidentStatus | null {
  return residentsStore.useStore((all) => all.find((r) => r.id === id) ?? null)
}

/** False until main has answered the first `residentsList`: an empty list before then means "not known yet". */
export const useResidentsLoaded = residentsStore.useLoaded
