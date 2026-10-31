import { useEffect } from 'react'
import { createLocalStore } from './createLocalStore'
import { onStatusBarHeightStored, readStatusBarHeight, writeStatusBarHeight } from './uiState'

export type StatusBarTier = 'compact' | 'comfortable' | 'tall'

export const STATUS_BAR_MIN = 22
export const STATUS_BAR_MAX = 64

/** The menu's presets, one per tier. */
export const STATUS_BAR_PRESETS: Record<StatusBarTier, number> = { compact: 22, comfortable: 34, tall: 52 }

export const TIER_LABEL: Record<StatusBarTier, string> = { compact: 'Compact', comfortable: 'Comfortable', tall: 'Tall' }

/**
 * Clamped, and snapped to an even number: every orb, badge and working height is even, so an even
 * bar centres them on whole pixels (a half pixel is what blurs the glyphs).
 */
export function clampStatusBarHeight(px: number): number {
  const even = Math.round(px / 2) * 2
  return Math.min(STATUS_BAR_MAX, Math.max(STATUS_BAR_MIN, even))
}

export function tierOf(height: number): StatusBarTier {
  if (height >= 44) return 'tall'
  if (height >= 30) return 'comfortable'
  return 'compact'
}

/** Null until this window first reads the saved height. */
const store = createLocalStore<number | null>(null)

function savedOrDefault(): number {
  return store.get() ?? clampStatusBarHeight(readStatusBarHeight() ?? STATUS_BAR_MIN)
}

/** Sets the height in this window; `save` also stores it, which every other window then follows. */
export function setStatusBarHeight(px: number, save = true): void {
  const next = clampStatusBarHeight(px)
  store.set(next)
  if (save) writeStatusBarHeight(next)
}

/** The bar's chosen height and the tier its layout follows. */
export function useStatusBarSize(): { height: number; tier: StatusBarTier } {
  const stored = store.useStore()
  useEffect(() => onStatusBarHeightStored((h) => { store.set(clampStatusBarHeight(h ?? STATUS_BAR_MIN)) }), [])
  const height = stored ?? savedOrDefault()
  return { height, tier: tierOf(height) }
}
