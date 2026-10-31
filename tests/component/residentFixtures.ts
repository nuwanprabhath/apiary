import type { ResidentConfig, ResidentMessage, ResidentOptionField, ResidentStatus } from '@shared/domain/residents'
import { kindInfos, kindOf, newResident } from '../../src/main/residents/kinds'
import type { FakeApiary } from './fakeApiary'

/** Every day, all day: an enabled resident with nothing running is idle, never asleep. */
const ALWAYS = { days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '00:00' }

/** Configures Regent in the fake's settings: on duty all day, enabled unless said otherwise. */
export function withRegent(fake: FakeApiary, opts: { enabled?: boolean; history?: ResidentMessage[] } = {}): void {
  const config = { ...newResident(kindOf('regent'), new Set()), enabled: opts.enabled ?? true, schedule: ALWAYS }
  fake.state.settings = { ...fake.state.settings, residents: [config] }
  if (opts.history !== undefined) fake.state.residentHistory.set(config.id, opts.history)
}

/** Regent's status as main would push it, in `state` with `activity`. */
export function regentStatus(state: ResidentStatus['state'], activity: string | null = null): ResidentStatus {
  return {
    id: 'regent', kind: 'regent', name: 'Regent', enabled: state !== 'asleep', state, activity, onDuty: true,
    appearance: { glyph: 'bee', palette: 'gold', animation: 'halo' }, digest: null, attention: null, permissions: [], quickActions: [], setupNeeded: null,
    cycle: null,
  }
}

/** Configures the MR desk beside whatever is configured: on duty all day, enabled. */
export function withMrDesk(fake: FakeApiary): void {
  const taken = new Set(fake.state.settings.residents.map((c) => c.id))
  const config = { ...newResident(kindOf('mr-desk'), taken), enabled: true, schedule: ALWAYS }
  fake.state.settings = { ...fake.state.settings, residents: [...fake.state.settings.residents, config] }
}

/** The MR desk's status as main would push it, with anything else it should carry. */
export function mrDeskStatus(state: ResidentStatus['state'], extra: Partial<ResidentStatus> = {}): ResidentStatus {
  return {
    id: 'mr-desk', kind: 'mr-desk', name: 'MR desk', enabled: state !== 'asleep', state, activity: null, onDuty: true,
    appearance: { glyph: 'honeypot', palette: 'amber', animation: 'stir' }, digest: null, attention: null, permissions: [], quickActions: [], setupNeeded: null,
    cycle: { everyMinutes: 15, nextAt: null, running: false },
    ...extra,
  }
}

/** The MR desk's config with nothing set yet, on duty all day. */
export function deskConfig(options: Record<string, string> = {}): ResidentConfig {
  return { ...newResident(kindOf('mr-desk'), new Set()), enabled: true, schedule: ALWAYS, options }
}

/** Option fields like the MR desk's: a required GitLab project (text) and a local clone (folder). */
export const DESK_FIELDS: ResidentOptionField[] = [
  { key: 'project', label: 'GitLab project', help: 'The group/project path its MRs are read from.', input: 'text', required: true },
  { key: 'clone', label: 'Local clone', help: 'Where it checks out a branch to review.', input: 'folder', required: true },
]

/** Gives the MR desk kind `DESK_FIELDS` in the fake, whatever main's kind declares today. */
export function withDeskFields(fake: FakeApiary): void {
  fake.override('residentKinds', async () => kindInfos().map((k) => (k.id === 'mr-desk' ? { ...k, optionFields: DESK_FIELDS } : k)))
}

let n = 0
export function message(role: ResidentMessage['role'], text: string, streaming = false): ResidentMessage {
  n += 1
  return { id: `${role}-${String(n)}`, role, text, at: Date.now(), streaming }
}
