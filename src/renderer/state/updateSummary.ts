import type { UpdateStatusPayload } from '@shared/api'

/**
 * The pure half of the updater's UI: turning a status into words.
 *
 * Kept apart from `useUpdate` — which touches `window` and so belongs to the renderer alone —
 * so these can be tested in plain Node, where the rules about what a check actually said are
 * cheap to pin down.
 */

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
 * What to say beside "Check now" once a check the user pressed for has finished.
 *
 * The status is taken from what the call itself resolved with, rather than from the pushed
 * subscription the banner listens to, for two reasons. A check that could not run at all (a dev
 * run, an unsupported platform) pushes nothing, so the subscription never fires and the button
 * appears to do nothing. And the banner the push feeds is drawn *behind* the settings dialog's
 * backdrop — so even when it works, the answer to a question asked inside the dialog was
 * somewhere the user could not see until they closed it.
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
