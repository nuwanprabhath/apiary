import {
  ACCESSORIES, ARMS, BODY_SHAPES, EYE_STYLES, LEGS, LIMITS, SITUATIONS, TEXTURES, TRAITS, slotOf,
  type Accessory, type AccessorySlot, type PetSpec, type Situation,
} from './spec'

/**
 * The one way anything becomes a pet — the security boundary of the pets feature, as
 * `validateTheme` is for themes. Its input is untrusted by construction: a reply from Claude, an
 * imported file, a hand-edited `pets.json`.
 *
 * - Only allowlisted names are read, as own properties (`__proto__` and friends are never looked at).
 * - Every choice must be one of the closed sets in spec.ts; anything else falls back to a default.
 * - A colour must be plainly `#rgb` or `#rrggbb` and comes out re-serialised as `#rrggbb`: it ends
 *   up in an SVG attribute, so nothing that is not unmistakably a colour gets there.
 * - Text is trimmed, stripped of control characters and capped. It is only ever drawn as a text
 *   node, never parsed.
 *
 * It returns null only when the input is not an object at all; otherwise it always returns a pet.
 */

const own = (o: unknown, k: string): unknown =>
  typeof o === 'object' && o !== null && Object.prototype.hasOwnProperty.call(o, k)
    ? (o as Record<string, unknown>)[k]
    : undefined

const oneOf = <T extends string>(list: readonly T[], v: unknown, fallback: T): T =>
  typeof v === 'string' && (list as readonly string[]).includes(v) ? v as T : fallback

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

export function cleanColor(v: unknown, fallback: string): string {
  if (typeof v !== 'string') return fallback
  const s = v.trim()
  if (!HEX.test(s)) return fallback
  const h = s.slice(1).toLowerCase()
  return h.length === 3 ? `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}` : `#${h}`
}

function cleanText(v: unknown, max: number): string {
  if (typeof v !== 'string') return ''
  // eslint-disable-next-line no-control-regex -- control characters are what is being removed
  const s = v.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim()
  return [...s].slice(0, max).join('').trim()
}

/** One line a pet says: plain, short, one line. Null when nothing is left of it. */
export function cleanLine(v: unknown): string | null {
  const s = cleanText(v, LIMITS.line)
  return s === '' ? null : s
}

export function cleanLines(v: unknown): Partial<Record<Situation, string[]>> {
  const out: Partial<Record<Situation, string[]>> = {}
  for (const situation of SITUATIONS) {
    const list = own(v, situation)
    if (!Array.isArray(list)) continue
    const lines = (list as unknown[]).map(cleanLine).filter((l): l is string => l !== null).slice(0, LIMITS.linesPerSituation)
    if (lines.length > 0) out[situation] = lines
  }
  return out
}

function unit(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5
}

export function validatePet(raw: unknown): PetSpec | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const body = own(raw, 'body')
  const eyes = own(raw, 'eyes')
  const traits = own(raw, 'traits')

  const color = cleanColor(own(body, 'color'), '#3b82f6')
  const seen = new Set<AccessorySlot>()
  const accessories: PetSpec['accessories'] = []
  const list = own(raw, 'accessories')
  for (const a of Array.isArray(list) ? (list as unknown[]) : []) {
    if (accessories.length >= LIMITS.accessories) break
    const kind = own(a, 'kind')
    if (typeof kind !== 'string' || !(ACCESSORIES as readonly string[]).includes(kind)) continue
    const slot = slotOf(kind as Accessory)
    if (seen.has(slot)) continue
    seen.add(slot)
    accessories.push({ kind: kind as Accessory, color: cleanColor(own(a, 'color'), '#1f1f2e') })
  }

  const name = cleanText(own(raw, 'name'), LIMITS.name)
  return {
    version: 1,
    name: name === '' ? 'Pet' : name,
    tagline: cleanText(own(raw, 'tagline'), LIMITS.tagline),
    body: {
      shape: oneOf(BODY_SHAPES, own(body, 'shape'), 'blob'),
      color,
      accent: cleanColor(own(body, 'accent'), color),
      texture: oneOf(TEXTURES, own(body, 'texture'), 'fuzzy'),
    },
    eyes: {
      style: oneOf(EYE_STYLES, own(eyes, 'style'), 'round'),
      color: cleanColor(own(eyes, 'color'), '#14141f'),
    },
    cheeks: own(raw, 'cheeks') !== false,
    arms: oneOf(ARMS, own(raw, 'arms'), 'nub'),
    legs: oneOf(LEGS, own(raw, 'legs'), 'stubby'),
    accessories,
    traits: Object.fromEntries(TRAITS.map((t) => [t, unit(own(traits, t))])) as PetSpec['traits'],
    lines: cleanLines(own(raw, 'lines')),
  }
}
