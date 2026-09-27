import { isWindowLayoutReport, type WindowLayoutReport } from '@shared/types'

/**
 * Validates a `reportLayout` payload and stamps it with the window number the main process
 * derived for the sender itself — never the number the payload claims (SEC-8).
 *
 * These records are auto-resumed at the next launch (see `main/index.ts`), so a window that could
 * send another window's number would overwrite that window's stored layout with its own, or
 * revive `live` sessions the other window never had open. `windowNumberFor` already resolves the
 * sender's real number from its `webContents.id`, so the payload's own `number` field is never
 * trusted — it exists only because `WindowLayoutReport` is also read back from `?restore=`
 * (`isWindowLayoutReport`), where there is no sender to derive it from.
 *
 * Pulled out of the IPC handler as a pure function so the override is unit-testable without
 * standing up `ipcMain`.
 */
export function resolveReportLayout(report: unknown, senderWindowNumber: number | null): WindowLayoutReport | null {
  if (senderWindowNumber === null || !isWindowLayoutReport(report)) return null
  return { ...report, number: senderWindowNumber }
}
