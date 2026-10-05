import { useEffect, useState } from 'react'
import type { PetsState } from '@shared/pets/state'

/** The pets as main has them, kept current by `petsChanged`; null until the first answer. */
export function usePets(): PetsState | null {
  const [state, setState] = useState<PetsState | null>(null)
  useEffect(() => {
    let cancelled = false
    void window.apiary.petsState().then((s) => { if (!cancelled) setState(s) }).catch(() => {})
    const off = window.apiary.onPetsChanged((s) => { setState(s) })
    return () => { cancelled = true; off() }
  }, [])
  return state
}
