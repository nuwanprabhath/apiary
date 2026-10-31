import type { ResidentStatus } from '@shared/domain/residents'
import { useResidents } from './residentsStore'
import { openResidentPopup, toggleResidentPopup } from './residentPopup'

/** The resident ⌘⇧Space and the search box's ⌘↵ talk to: the first enabled one, in settings order. */
function firstEnabledResident(residents: readonly ResidentStatus[]): ResidentStatus | null {
  return residents.find((r) => r.enabled) ?? null
}

export function useFirstEnabledResident(): ResidentStatus | null {
  return firstEnabledResident(useResidents())
}

/**
 * ⌘⇧Space: toggles the first enabled resident's popup. With none enabled it opens the first
 * configured one's popup (which says "Enable in Settings"), and with none configured it opens
 * Settings at Residents.
 */
export function summonResident(residents: readonly ResidentStatus[], openSettings: (section: string) => void): void {
  const enabled = firstEnabledResident(residents)
  if (enabled !== null) toggleResidentPopup(enabled.id)
  else if (residents.length > 0) openResidentPopup(residents[0].id)
  else openSettings('residents')
}
