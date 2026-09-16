import { app } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { log } from './logger'
import type { AppSettings } from '../settings'

/**
 * Points the logger at this installation's log folder and applies the user's limits.
 *
 * Separate from `logger.ts` so that module stays free of Electron: it is imported by `ptyManager`
 * and the git helpers, which are exercised in plain Node unit tests, and a transitive `electron`
 * import there is a test that cannot run.
 */
export function logDir(): string {
  return join(app.getPath('userData'), 'logs')
}

export function configureLogging(settings: AppSettings): void {
  log.configure({
    enabled: settings.diagnosticsEnabled,
    dir: logDir(),
    retentionDays: settings.logRetentionDays,
    maxSizeMb: settings.logMaxSizeMb,
    home: homedir(),
  })
}
