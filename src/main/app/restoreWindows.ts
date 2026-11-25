import { log } from '../log/logger'
import { isRestorable, pruneStaleLive } from '../windows/sessionLayoutRestore'
import type { Container } from './container'

/**
 * Opens the windows the layout file held at launch (no window exists yet to have reported anything
 * since), with live sessions that can no longer resume pruned; a fresh window when none is saved.
 * `openFirst` false is a background launch: no window until a normal one.
 */
export function restoreWindows(container: Container, openFirst: boolean): void {
  const { windowManager, service } = container
  const stored = container.sessionLayoutStore.snapshot()
  const records = stored.windows
    .map((r) => pruneStaleLive(r, (id) => service.sessionIsResumable(id)))
    .filter(isRestorable)
  log.info('window', 'restoring', {
    saved: stored.windows.map((r) => r.number),
    restoring: records.map((r) => r.number),
  })
  if (!openFirst) return
  if (records.length === 0) {
    windowManager.create()
    return
  }
  windowManager.advanceOpenedTo(Math.max(0, ...records.map((r) => r.number)))
  for (const record of records) windowManager.create({ restore: record })
}
