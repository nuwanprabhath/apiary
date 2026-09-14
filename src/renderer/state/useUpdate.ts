import { useEffect, useState } from 'react'
import type { UpdateStatusPayload } from '@shared/api'

/**
 * The updater's state, as the UI sees it.
 *
 * One subscription, shared by the banner and the Settings panel, so the two can never disagree
 * about whether a download is running. The main process is the only source of truth — it owns the
 * schedule and the download — and pushes the whole status on every transition rather than the UI
 * polling for it.
 */
export function useUpdate(): UpdateStatusPayload | null {
  const [status, setStatus] = useState<UpdateStatusPayload | null>(null)

  useEffect(() => {
    void window.apiary.updateStatus().then(setStatus).catch(() => { setStatus(null) })
    return window.apiary.onUpdateChanged(setStatus)
  }, [])

  return status
}
