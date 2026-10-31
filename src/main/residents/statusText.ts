import type { DigestLookback, ResidentConfig, ResidentCycle, ResidentStatus } from '@shared/domain/residents'
import { lookbackText } from '@shared/digestLookback'
import { clockText, DAY_NAMES, dutyStatusText } from '@shared/residentSchedule'

/** What `apiary_status` reads: the caller's status and config, the index's size and the other residents. */
export interface StatusReport {
  self: ResidentStatus
  config: ResidentConfig
  lookback: DigestLookback | null
  index: { sessions: number; topics: number } | null
  others: ResidentStatus[]
  now: Date
}

const attentionText = (s: ResidentStatus): string =>
  s.attention === null ? 'nothing' : s.attention.count > 0 ? `${String(s.attention.count)}: ${s.attention.summary}` : s.attention.summary

/** "Apiary runs it every 15 minutes during your hours; next at 14:45; none is running now". */
function cycleText(cycle: ResidentCycle, now: Date): string {
  const next = cycle.nextAt === null ? 'none scheduled (disabled or no duty hours ahead)' : `next at ${clockText(new Date(cycle.nextAt), now)}`
  return `Apiary runs it every ${String(cycle.everyMinutes)} minutes during your hours; ${next}; ${cycle.running ? 'one is running now' : 'none is running now'}`
}

/** The `apiary_status` answer: compact lines, for the model to read. */
export function apiaryStatusText(r: StatusReport): string {
  const { self, config } = r
  const days = config.schedule.days.map((d) => DAY_NAMES[d]).join(' ') || 'no days'
  const lines = [
    `You: ${self.name} (${self.kind}), ${self.enabled ? self.state : 'disabled'}${self.activity !== null ? ` — ${self.activity}` : ''}.`,
    `Duty: ${dutyStatusText(config.schedule, r.now)}. Schedule: ${days}, ${config.schedule.start}–${config.schedule.end}.`,
  ]
  if (self.digest !== null) {
    lines.push(`Digest: ${String(self.digest.done)}/${String(self.digest.total)} sessions this pass, looking back ${lookbackText(r.lookback)}.`)
  }
  if (self.cycle !== null) lines.push(`Cycle: ${cycleText(self.cycle, r.now)}.`)
  if (r.index !== null) lines.push(`Index: ${String(r.index.sessions)} sessions digested, ${String(r.index.topics)} topics.`)
  lines.push(`Your attention flag: ${attentionText(self)}.`)
  if (self.setupNeeded !== null) lines.push(`Setup needed: ${self.setupNeeded}.`)
  lines.push(r.others.length === 0 ? 'Other residents: none.' : 'Other residents:')
  for (const o of r.others) lines.push(`- ${o.name} (${o.kind}): ${o.enabled ? o.state : 'disabled'}, attention: ${attentionText(o)}`)
  return lines.join('\n')
}
