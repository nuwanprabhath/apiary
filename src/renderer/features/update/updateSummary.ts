import type { UpdateStatusPayload } from '@shared/api'

// The pure half of the updater's UI, apart from `useUpdate` (which touches `window`) so it tests in plain Node.

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

/**
 * What to say beside "Check now". The status comes from what the call resolved with, not the pushed
 * subscription: a check that could not run (dev run, unsupported platform) pushes nothing, and the
 * banner the push feeds is drawn behind the settings dialog's backdrop.
 */
export function describeCheck(status: UpdateStatusPayload): string {
  if (status.capability.kind === 'unsupported') return status.capability.reason
  if (status.phase === 'error') {
    return `Could not check — ${status.error ?? 'the release feed could not be reached.'}`
  }
  if (status.availableVersion !== null) {
    return `Apiary ${formatVersion(status.availableVersion)} is available.`
  }
  return `Apiary ${formatVersion(status.currentVersion)} is the latest version.`
}
