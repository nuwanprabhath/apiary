import { clamp, isFiniteNumber, isOneOf, isRecord } from '../guards'
import type { Guard } from '../ipc/guards'
import { CYCLE_MINUTES, RESIDENT_KINDS, type ResidentConfig, type ResidentSchedule } from '../domain/residents'
import { isChatPermissionMode } from '../domain/chat'
import { isDigestLookback } from '../digestLookback'

/**
 * The `residents` setting's guard and constraint (`SETTINGS.residents`). Kinds are declared in
 * `main/residents/kinds.ts`; this side only knows their ids (`RESIDENT_KINDS`).
 */

/** A resident id names its folder (`userData/residents/<id>/`), so it is a slug and nothing else. */
export const RESIDENT_ID_RE = /^[a-z][a-z0-9-]{0,39}$/
const RESIDENT_NAME_MAX = 40
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const OPTION_KEY_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/
const OPTION_VALUE_MAX = 1000
const OPTIONS_MAX = 20

const isCycleMinutes = (v: unknown): v is number => typeof v === 'number' && (CYCLE_MINUTES as readonly number[]).includes(v)

type AddedFields = 'permissionMode' | 'digestLookback' | 'options' | 'cycleEveryMinutes'

/** What a config saved before these fields existed gets for them: the behaviour it had then. */
export const RESIDENT_FIELD_DEFAULTS: Pick<ResidentConfig, AddedFields> = {
  permissionMode: 'auto', digestLookback: null, options: {}, cycleEveryMinutes: null,
}

/** A config as any build saved it: the fields added since Regent first shipped may be missing. */
type SavedResidentConfig = Omit<ResidentConfig, 'kind' | AddedFields> & { kind: string } & Partial<Record<AddedFields, unknown>>

const isSchedule = (v: unknown): v is ResidentSchedule =>
  isRecord(v) && Array.isArray(v.days) && v.days.every(isFiniteNumber)
  && typeof v.start === 'string' && typeof v.end === 'string'

/** The shape of a config, with any kind string: a kind this build does not know is dropped by `constrainResidents`, not the whole list. */
function hasConfigShape(v: unknown): v is SavedResidentConfig {
  return isRecord(v) && typeof v.id === 'string' && typeof v.kind === 'string' && typeof v.name === 'string'
    && typeof v.enabled === 'boolean' && typeof v.model === 'string' && typeof v.digestModel === 'string'
    && isSchedule(v.schedule) && isFiniteNumber(v.pauseAboveUsagePercent)
}

/** A config this build can run: the shape, a known kind and a slug id. */
function isRunnable(v: unknown): v is SavedResidentConfig & Pick<ResidentConfig, 'kind'> {
  return hasConfigShape(v) && isOneOf(RESIDENT_KINDS, v.kind) && RESIDENT_ID_RE.test(v.id)
}

/** The setting's guard. The kind is narrowed, and missing fields filled, by `constrainResidents`. */
export const isResidentList: Guard<ResidentConfig[]> = (v): v is ResidentConfig[] =>
  Array.isArray(v) && v.every(hasConfigShape)

/** A model alias or id is one `claude --model` value: no spaces, nothing a shell would read. */
const MODEL_RE = /^[a-zA-Z0-9][a-zA-Z0-9.[\]_-]{0,79}$/

/** The kind's options that are strings under a slug key, capped; anything else is dropped. */
function cleanOptions(options: unknown): Record<string, string> {
  if (!isRecord(options)) return {}
  const entries = Object.entries(options)
    .filter((e): e is [string, string] => OPTION_KEY_RE.test(e[0]) && typeof e[1] === 'string' && e[1].length <= OPTION_VALUE_MAX)
  return Object.fromEntries(entries.slice(0, OPTIONS_MAX))
}

function normalise(c: SavedResidentConfig & Pick<ResidentConfig, 'kind'>): ResidentConfig | null {
  const name = c.name.trim().slice(0, RESIDENT_NAME_MAX).trim()
  if (name === '' || !TIME_RE.test(c.schedule.start) || !TIME_RE.test(c.schedule.end)) return null
  if (!MODEL_RE.test(c.model) || !MODEL_RE.test(c.digestModel)) return null
  const days = [...new Set(c.schedule.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b)
  return {
    id: c.id, kind: c.kind, name, enabled: c.enabled, model: c.model, digestModel: c.digestModel,
    schedule: { days, start: c.schedule.start, end: c.schedule.end },
    pauseAboveUsagePercent: clamp(Math.round(c.pauseAboveUsagePercent), 0, 100),
    permissionMode: isChatPermissionMode(c.permissionMode) ? c.permissionMode : RESIDENT_FIELD_DEFAULTS.permissionMode,
    digestLookback: isDigestLookback(c.digestLookback) ? c.digestLookback : RESIDENT_FIELD_DEFAULTS.digestLookback,
    options: cleanOptions(c.options),
    cycleEveryMinutes: isCycleMinutes(c.cycleEveryMinutes) ? c.cycleEveryMinutes : RESIDENT_FIELD_DEFAULTS.cycleEveryMinutes,
  }
}

/**
 * Fills what a config saved by an older build lacks (`RESIDENT_FIELD_DEFAULTS`; an invalid
 * permission mode or lookback gets the same), drops unknown kinds and repeated ids (the first
 * wins), trims names, dedupes and sorts days and clamps the usage pause. A config with an empty
 * name, a time that is not `HH:MM` or a bad model rejects the whole value, which leaves the
 * setting as it was.
 */
export function constrainResidents(list: ResidentConfig[]): ResidentConfig[] | undefined {
  const out: ResidentConfig[] = []
  const ids = new Set<string>()
  for (const entry of list) {
    if (!isRunnable(entry) || ids.has(entry.id)) continue
    const config = normalise(entry)
    if (config === null) return undefined
    ids.add(config.id)
    out.push(config)
  }
  return out
}

/**
 * The list as read from settings.json, which skips `mergePayload`: constrained like a write, so a
 * config saved before a field existed gets it filled. A list that would be refused as a whole is
 * kept with only the missing fields filled, as it was running before.
 */
export function loadResidents(raw: unknown): ResidentConfig[] {
  if (!isResidentList(raw)) return []
  return constrainResidents(raw) ?? raw.map((c) => ({ ...RESIDENT_FIELD_DEFAULTS, ...c }))
}
