import { useEffect, useState } from 'react'
import type { StatusBarItem } from '@shared/domain/statusBar'

/** The status-bar plugins' items, re-read whenever main says they changed. Push-driven: the
 *  plugins keep their own schedules in main, so nothing here polls. */
export function useStatusBar(): StatusBarItem[] {
  const [items, setItems] = useState<StatusBarItem[]>([])
  useEffect(() => {
    let cancelled = false
    let latest = 0
    const load = (): void => {
      const request = ++latest
      window.apiary.statusBarItems()
        .then((next) => { if (!cancelled && request === latest) setItems(next) })
        .catch(() => { /* a bar with nothing on it is the honest answer */ })
    }
    load()
    const off = window.apiary.onStatusBarChanged(load)
    return () => { cancelled = true; off() }
  }, [])
  return items
}
