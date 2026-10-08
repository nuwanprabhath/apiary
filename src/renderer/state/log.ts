import type { LogLevel, LogScope, LogStatusPayload } from '@shared/domain/log'

/** One line to the diagnostic log (a no-op in main when logging is off). Cannot fail: it is a send.
 *  A leaf on purpose — the error policy itself writes through it. */
export function logLine(level: LogLevel, scope: LogScope, message: string, fields?: Record<string, unknown>): void {
  window.apiary.logWrite(level, scope, message, fields)
}

/** Where the logs are and how big; the Diagnostics section renders the failure inline. */
export const readLogStatus = (): Promise<LogStatusPayload> => window.apiary.logStatus()
