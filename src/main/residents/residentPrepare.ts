import { errorMessage } from '@shared/errors'
import { log } from '../log/logger'
import type { Resident } from './residentStatus'

/**
 * Runs the kind's `prepare` when its options changed, or again while its `setup` still reports
 * something (so installing a tool is noticed by the next re-check). One run at a time; `r.ready`
 * settles when it ends, and `settled` is called then.
 */
export function prepareResident(r: Resident, settled: () => void): void {
  const prepare = r.kind.prepare
  const key = JSON.stringify(r.config.options)
  if (prepare === undefined || r.preparing) return
  if (key === r.preparedFor && r.kind.setup(r.config) === null) return
  r.preparing = true
  r.preparedFor = key
  r.ready = (async () => {
    try {
      r.space.ensure()
      await prepare(r.config, r.space.dir)
    } catch (e) {
      log.warn('residents', 'prepare failed', { resident: r.config.id, error: errorMessage(e) })
    } finally {
      r.preparing = false
      // Options saved while it ran (the project, then the clone) would otherwise wait for the next re-check.
      if (JSON.stringify(r.config.options) !== r.preparedFor) prepareResident(r, settled)
      settled()
    }
  })()
}
