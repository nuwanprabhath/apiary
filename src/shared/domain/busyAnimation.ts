import type { Guard } from '../ipc/guards'

/**
 * The animation beside "Claude is working", and its colour: the choices, declared once.
 *
 * Adding an animation is an id here, its entry in `BUSY_ANIMATIONS` (a missing one does not
 * compile), its view in `renderer/ui/BusyGlyph.tsx` (likewise) and its styles in `35-busy.css`.
 * Adding a colour is the same: an id, an entry in `BUSY_COLORS`, and its `data-busy-color` rule.
 */
export const BUSY_ANIMATION_IDS = ['spark', 'orbit', 'comet', 'atom'] as const
export type BusyAnimationId = (typeof BUSY_ANIMATION_IDS)[number]

export const BUSY_COLOR_IDS = ['theme', 'claude', 'mono', 'aurora'] as const
export type BusyColorId = (typeof BUSY_COLOR_IDS)[number]

export interface BusyAnimationInfo {
  label: string
  description: string
  /** The colours it can be drawn in, the first being what it falls back to. */
  colors: readonly [BusyColorId, ...BusyColorId[]]
}

export const BUSY_ANIMATIONS: Record<BusyAnimationId, BusyAnimationInfo> = {
  spark: { label: 'Spark', description: "Claude Code's own glyph", colors: ['theme', 'claude', 'mono', 'aurora'] },
  orbit: { label: 'Orbit', description: 'Three planets on a rocking orbit', colors: ['claude', 'theme', 'mono', 'aurora'] },
  comet: { label: 'Comet', description: 'The orbit, each planet trailing a tail', colors: ['claude', 'theme', 'mono', 'aurora'] },
  atom: { label: 'Atom', description: 'Three electrons on crossed rings', colors: ['claude', 'theme', 'mono', 'aurora'] },
}

export const BUSY_COLORS: Record<BusyColorId, { label: string }> = {
  theme: { label: 'Theme accent' },
  claude: { label: 'Claude' },
  mono: { label: 'Monochrome' },
  aurora: { label: "Theme's palette" },
}

export const isBusyAnimationId: Guard<BusyAnimationId> = (v): v is BusyAnimationId => BUSY_ANIMATION_IDS.some((id) => id === v)
export const isBusyColorId: Guard<BusyColorId> = (v): v is BusyColorId => BUSY_COLOR_IDS.some((id) => id === v)

/** The colour `animation` is drawn in: the chosen one when it offers it, else its own first. */
export function busyColorFor(animation: BusyAnimationId, color: BusyColorId): BusyColorId {
  const offered = BUSY_ANIMATIONS[animation].colors
  return offered.includes(color) ? color : offered[0]
}
