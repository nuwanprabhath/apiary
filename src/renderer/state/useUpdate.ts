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

/** A version string for display: `1.9.0` reads better than `v1.9.0` beside a label saying Version. */
export function formatVersion(version: string): string {
  return version.replace(/^v/, '')
}

/** "Never", or a short local date-time — the useful form for "last checked". */
export function formatChecked(at: number | null): string {
  if (at === null) return 'Never'
  const date = new Date(at)
  const today = new Date()
  const sameDay = date.toDateString() === today.toDateString()
  return sameDay
    ? `Today at ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
    : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}
