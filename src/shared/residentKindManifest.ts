import { isRecord, isOneOf, own } from './guards'
import {
  CYCLE_MINUTES, isResidentKindId,
  type ResidentAnimation, type ResidentAppearance, type ResidentGlyph, type ResidentKindId, type ResidentPalette,
} from './domain/residents'

/**
 * A resident kind defined by a folder the user drops in (`userData/resident-kinds/<id>/kind.json`
 * plus an optional `PROMPT.md`). It is data, never code: it chooses from closed sets and carries
 * text, and `validateResidentKindManifest` is the only way in. It can never name a command, a
 * binary, an environment or a `prepare` hook (ADR-0022).
 */

/** The Apiary tool groups a data kind may ask for: every capability except those that need a kind's own code (`gitlab.approve` needs an `approval`). */
export const MANIFEST_CAPABILITIES = [
  'sessions.read', 'workspace.read', 'workspace.open', 'space.notes', 'apiary.status', 'resident.attention',
] as const
export type ManifestCapability = (typeof MANIFEST_CAPABILITIES)[number]

const KIND_GLYPHS = ['bee', 'honeypot'] as const satisfies readonly ResidentGlyph[]
const KIND_PALETTES = ['gold', 'amber'] as const satisfies readonly ResidentPalette[]
const KIND_ANIMATIONS = ['halo', 'stir'] as const satisfies readonly ResidentAnimation[]

export const MANIFEST_LIMITS = { name: 40, blurb: 200, prompt: 20_000, doing: 40, label: 60, help: 200, key: 40, list: 20 } as const

export interface ManifestOptionField { key: string; label: string; help: string; required: boolean }
export interface ManifestQuickAction { id: string; label: string; doing: string; text: string }

export interface ResidentKindManifest {
  id: ResidentKindId
  name: string
  blurb: string
  appearance: ResidentAppearance
  capabilities: ManifestCapability[]
  optionFields: ManifestOptionField[]
  quickActions: ManifestQuickAction[]
  /** The prompt from `kind.json`; `PROMPT.md` follows it. */
  prompt: string
  cycle?: { everyMinutes: number; prompt: string; doing: string }
  toolPolicy?: { disallowedTools: string[] }
}

export type ManifestResult = { ok: true; manifest: ResidentKindManifest } | { ok: false; reasons: string[] }

/** Whether a character is kept: printable, or a newline or tab. */
function keepsChar(ch: string): boolean {
  const c = ch.charCodeAt(0)
  return c === 9 || c === 10 || (c >= 32 && c !== 127)
}

/** Text with control characters removed (newline and tab kept), cut to `max`; anything not a string is `fallback`. */
function manifestText(v: unknown, max: number, fallback = ''): string {
  return typeof v === 'string' ? [...v].filter(keepsChar).join('').slice(0, max) : fallback
}

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v.slice(0, MANIFEST_LIMITS.list) : [])

function optionFields(v: unknown): ManifestOptionField[] {
  return list(v).filter((f) => own(f, 'input') === 'text' && isResidentKindId(own(f, 'key'))).map((f) => ({
    key: manifestText(own(f, 'key'), MANIFEST_LIMITS.key),
    label: manifestText(own(f, 'label'), MANIFEST_LIMITS.label),
    help: manifestText(own(f, 'help'), MANIFEST_LIMITS.help),
    required: own(f, 'required') === true,
  }))
}

function quickActions(v: unknown): ManifestQuickAction[] {
  return list(v).filter((a) => own(own(a, 'run'), 'kind') === 'prompt' && isResidentKindId(own(a, 'id'))).map((a) => ({
    id: manifestText(own(a, 'id'), MANIFEST_LIMITS.key),
    label: manifestText(own(a, 'label'), MANIFEST_LIMITS.label),
    doing: manifestText(own(a, 'doing'), MANIFEST_LIMITS.doing),
    text: manifestText(own(own(a, 'run'), 'text'), MANIFEST_LIMITS.prompt),
  }))
}

function appearance(v: unknown): ResidentAppearance {
  const glyph = own(v, 'glyph')
  const palette = own(v, 'palette')
  const animation = own(v, 'animation')
  return {
    glyph: isOneOf(KIND_GLYPHS, glyph) ? glyph : 'bee',
    palette: isOneOf(KIND_PALETTES, palette) ? palette : 'gold',
    animation: isOneOf(KIND_ANIMATIONS, animation) ? animation : 'halo',
  }
}

function cycle(v: unknown, reasons: string[]): ResidentKindManifest['cycle'] {
  if (v === undefined) return undefined
  const every = own(v, 'everyMinutes')
  const minutes = CYCLE_MINUTES.find((m) => m === every)
  if (minutes === undefined) { reasons.push(`cycle.everyMinutes must be one of ${CYCLE_MINUTES.join(', ')}`); return undefined }
  return {
    everyMinutes: minutes,
    prompt: manifestText(own(v, 'prompt'), MANIFEST_LIMITS.prompt),
    doing: manifestText(own(v, 'doing'), MANIFEST_LIMITS.doing, 'Checking'),
  }
}

/**
 * A manifest from anything read off disk, or the reasons it is refused. Total: it never throws.
 * Reads only the allowlisted own properties, so an unknown key (or `bins`, `env`, `prepare`,
 * `digests`, a command) is dropped. `reserved` is the built-in kinds' ids.
 */
export function validateResidentKindManifest(raw: unknown, reserved: ReadonlySet<string>): ManifestResult {
  if (!isRecord(raw)) return { ok: false, reasons: ['kind.json is not a JSON object'] }
  const id = own(raw, 'id')
  if (!isResidentKindId(id)) return { ok: false, reasons: ['id must be lower-case letters, digits and -, at most 40 characters'] }
  if (reserved.has(id)) return { ok: false, reasons: [`id ${id} is a built-in kind`] }
  const reasons: string[] = []
  const caps = list(own(raw, 'capabilities')).filter((c): c is ManifestCapability => isOneOf(MANIFEST_CAPABILITIES, c))
  const disallowed = own(own(raw, 'toolPolicy'), 'disallowedTools')
  const manifest: ResidentKindManifest = {
    id,
    name: manifestText(own(raw, 'name'), MANIFEST_LIMITS.name) || id,
    blurb: manifestText(own(raw, 'blurb'), MANIFEST_LIMITS.blurb),
    appearance: appearance(own(raw, 'appearance')),
    capabilities: [...new Set(caps)],
    optionFields: optionFields(own(raw, 'optionFields')),
    quickActions: quickActions(own(raw, 'quickActions')),
    prompt: manifestText(own(raw, 'prompt'), MANIFEST_LIMITS.prompt),
  }
  const c = cycle(own(raw, 'cycle'), reasons)
  if (c !== undefined) manifest.cycle = c
  if (Array.isArray(disallowed)) {
    manifest.toolPolicy = {
      disallowedTools: list(disallowed).filter((t): t is string => typeof t === 'string').map((t) => manifestText(t, MANIFEST_LIMITS.label)),
    }
  }
  return reasons.length > 0 ? { ok: false, reasons } : { ok: true, manifest }
}
