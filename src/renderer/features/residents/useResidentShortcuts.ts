import { useEffect } from 'react'
import { useResidents } from '../../state/residentsStore'
import { summonResident } from '../../state/residentSummon'

const isMac = navigator.userAgent.includes('Mac')

/**
 * ⌘⇧Space (Ctrl+Shift+Space elsewhere) summons the resident in this window. A renderer key handler
 * rather than a menu accelerator, because the popup is per window: the focused window's own handler
 * is the one that hears it. It listens in the capture phase so a terminal that has focus does not
 * take the key first.
 */
export function useResidentShortcuts(openSettings: (section: string) => void): void {
  const residents = useResidents()
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
      if (!mod || !e.shiftKey || e.altKey || e.code !== 'Space') return
      e.preventDefault()
      e.stopPropagation()
      summonResident(residents, openSettings)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => { window.removeEventListener('keydown', onKeyDown, true) }
  }, [residents, openSettings])
}
