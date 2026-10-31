/** Where the tall tier starts (`tierOf` in statusBarSize.ts): from here the orb follows the height. */
const FOLLOW_FROM = 44

/** From this height the status bar's words are a size larger (`data-text="large"`). */
export const LARGE_TEXT_FROM = 58

export interface ResidentSizes { orb: number; bee: number; pot: number; badge: number }

const even = (px: number): number => Math.round(px / 2) * 2

/**
 * The resident orb, its glyphs and its badge in a bar of `height` px (44 or more): the orb fills the
 * height less a margin, between 32 and 50; the bee is three quarters of it and the honey pot four
 * fifths, as in the compact bar. Every size is even, so each centres inside the next on whole pixels.
 */
export function residentSizesFor(height: number): ResidentSizes {
  const orb = even(Math.min(50, Math.max(32, Math.max(FOLLOW_FROM, height) - 14)))
  return { orb, bee: even(orb * 0.75), pot: even(orb * 0.8), badge: Math.min(even(height), orb + 4) }
}
