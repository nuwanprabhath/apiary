import { app } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { log } from './logger'

/**
 * Points the logger at this installation's log folder and applies the user's limits.
 *
 * Separate from `logger.ts` so that module stays free of Electron: it is imported by `ptyManager`
 * and the git helpers, which are exercised in plain Node unit tests, and a transitive `electron`
 * import there is a test that cannot run.
 */
function logDir(): string {
  return join(app.getPath('userData'), 'logs')
}

/** The slice of the settings that governs the diagnostic log; `AppSettings` has these fields. */
interface LoggingSettings {
  diagnosticsEnabled: boolean
  logRetentionDays: number
  logMaxSizeMb: number
  gdprStrictMode: boolean
}

/** Privacy mode keeps logs at most this long; the stored `logRetentionDays` is left as chosen. */
const STRICT_RETENTION_DAYS = 7

/** The retention the logger applies: the setting, clamped in privacy mode. */
export function effectiveLogRetentionDays(settings: Pick<LoggingSettings, 'logRetentionDays' | 'gdprStrictMode'>): number {
  return settings.gdprStrictMode ? Math.min(settings.logRetentionDays, STRICT_RETENTION_DAYS) : settings.logRetentionDays
}

/**
 * Called at startup and on every settings save, so strict mode is read from the same settings the
 * privacy gate reads, and a change reaches the logger at once.
 */
export function configureLogging(settings: LoggingSettings): void {
  const strict = settings.gdprStrictMode
  log.configure({
    enabled: settings.diagnosticsEnabled,
    dir: logDir(),
    strict: () => strict,
    retentionDays: effectiveLogRetentionDays(settings),
    maxSizeMb: settings.logMaxSizeMb,
    home: homedir(),
  })
}
