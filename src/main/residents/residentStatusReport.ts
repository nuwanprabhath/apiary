import type { ResidentStatus } from '@shared/domain/residents'
import type { DigestJob } from '../knowledge/types'
import type { Resident } from './residentStatus'
import { apiaryStatusText } from './statusText'

/** The `apiary_status` text for `r`: its own status, its config and holds, the index size and the other residents. */
export function residentStatusReport(r: Resident, at: {
  now: Date
  self: ResidentStatus
  others: ResidentStatus[]
  digest: DigestJob | null
}): string {
  return apiaryStatusText({
    self: at.self,
    config: r.config,
    lookback: r.config.digestLookback,
    index: r.kind.digests ? at.digest?.indexSize() ?? null : null,
    others: at.others,
    now: at.now,
    background: r.chat.backgroundTasks(),
    keptAwake: r.holds.map((h) => h.reason),
    permissions: r.permissions,
  })
}
