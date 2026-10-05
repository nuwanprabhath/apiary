import type { PetPlace } from './state'

/**
 * Where pets may be: an L along the window's edge — up the collapsed sidebar's rail, and along the
 * empty part of the status bar — joined at the bottom-left corner. Pure geometry in viewport
 * pixels, so it can be tested without a window; `useHabitat` measures the two rects.
 *
 * A place is a region and a fraction along it, not pixels, so resizing the window keeps a pet
 * where it was relative to its edge. A point is where the pet's feet are: the bottom-centre of the
 * pet, which is drawn above it.
 */

export interface Rect { x: number; y: number; width: number; height: number }
export interface Point { x: number; y: number }

export interface Habitat {
  /** The collapsed sidebar's rail; null while the sidebar is shown. */
  rail: Rect | null
  /** The free stretch of the status bar (its spacer, left of any items). */
  bar: Rect
}

/** The rail's own button sits at its top; pets stop below it. */
export const RAIL_TOP_RESERVE = 44
const INSET = 2

const clamp01 = (n: number): number => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0))

function railSpan(rail: Rect): { bottom: number; top: number } {
  const bottom = rail.y + rail.height - INSET
  const top = Math.min(bottom, rail.y + RAIL_TOP_RESERVE)
  return { bottom, top }
}

function barSpan(bar: Rect, size: number): { left: number; right: number } {
  const left = bar.x + size / 2 + INSET
  const right = Math.max(left, bar.x + bar.width - size / 2 - INSET)
  return { left, right }
}

export function placeToPoint(h: Habitat, p: PetPlace, size: number): Point {
  const at = clamp01(p.at)
  if (p.region === 'rail' && h.rail !== null) {
    const { bottom, top } = railSpan(h.rail)
    return { x: h.rail.x + h.rail.width / 2, y: bottom - at * (bottom - top) }
  }
  const { left, right } = barSpan(h.bar, size)
  return { x: left + at * (right - left), y: h.bar.y + h.bar.height - INSET }
}

/** The place nearest a point — where a pet dropped there lands. */
export function nearestPlace(h: Habitat, pt: Point, size: number): PetPlace {
  const { left, right } = barSpan(h.bar, size)
  const barAt = right > left ? clamp01((pt.x - left) / (right - left)) : 0
  const onBar = placeToPoint(h, { region: 'bar', at: barAt }, size)
  if (h.rail === null) return { region: 'bar', at: barAt }
  const { bottom, top } = railSpan(h.rail)
  const railAt = bottom > top ? clamp01((bottom - pt.y) / (bottom - top)) : 0
  const onRail = placeToPoint(h, { region: 'rail', at: railAt }, size)
  const d = (a: Point): number => Math.hypot(a.x - pt.x, a.y - pt.y)
  return d(onRail) < d(onBar) ? { region: 'rail', at: railAt } : { region: 'bar', at: barAt }
}

/** A place that exists now: none yet → on the bar at `fallbackAt`; the rail gone → the corner. */
export function normalisePlace(h: Habitat, p: PetPlace | null, fallbackAt: number): PetPlace {
  if (p === null) return { region: 'bar', at: clamp01(fallbackAt) }
  if (p.region === 'rail' && h.rail === null) return { region: 'bar', at: 0 }
  return { region: p.region, at: clamp01(p.at) }
}

/** How far apart two places are walking along the L (through the corner), in pixels. */
export function walkDistance(h: Habitat, a: PetPlace, b: PetPlace, size: number): number {
  const s = (p: PetPlace): number => {
    const pt = placeToPoint(h, p, size)
    const corner = placeToPoint(h, { region: 'bar', at: 0 }, size)
    if (p.region === 'bar' || h.rail === null) return Math.abs(pt.x - corner.x)
    // Up the rail counts negative, plus the hop down from the rail's foot to the bar.
    const foot = placeToPoint(h, { region: 'rail', at: 0 }, size)
    return -(Math.abs(foot.y - pt.y) + Math.hypot(foot.x - corner.x, foot.y - corner.y))
  }
  return Math.abs(s(a) - s(b))
}

/** The lengths the brain walks along, in pixels. */
export function habitatLengths(h: Habitat, size: number): { rail: number; bar: number } {
  const { left, right } = barSpan(h.bar, size)
  if (h.rail === null) return { rail: 0, bar: right - left }
  const { bottom, top } = railSpan(h.rail)
  return { rail: bottom - top, bar: right - left }
}
