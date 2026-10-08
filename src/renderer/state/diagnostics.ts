import type { LogStatusPayload } from '@shared/domain/log'
import { attempt, surface } from './policy'

/** The Diagnostics section's two buttons on the log folder (the log itself is `state/log.ts`). */

/** Opens the log folder in the file manager. */
export function revealLogFolder(): void {
  surface(window.apiary.logReveal(), 'Could not open the log folder')
}

/** Deletes the logs; the new status, or null when it failed (and the user was told). */
export async function clearLogs(): Promise<LogStatusPayload | null> {
  let status: LogStatusPayload | null = null
  const ok = await attempt(window.apiary.logClear().then((s) => { status = s }), 'Could not delete the logs')
  return ok ? status : null
}
