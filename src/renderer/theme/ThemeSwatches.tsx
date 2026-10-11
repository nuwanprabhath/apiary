import type { JSX } from 'react'
import { DEFAULT_PALETTE, type ThemeSpec, type PaletteToken } from '@shared/theme/spec'

const SWATCHES: PaletteToken[] = ['bg-window', 'bg-panel', 'bg', 'text', 'accent', 'info', 'success']

const EFFECT_NAMES: Record<string, string> = {
  'digital-rain': 'Digital rain', 'perspective-grid': 'Perspective grid', 'starfield': 'Starfield',
  'noise': 'Noise', 'gradient-drift': 'Gradient drift', 'aurora': 'Aurora', 'scanlines': 'Scanlines',
  'crt-vignette': 'CRT vignette', 'neon-glow': 'Neon glow', 'glitch-flicker': 'Glitch', 'paper-grain': 'Paper grain',
}

/** The palette strip and the effects summary (`effectsLabel`) share this file because both describe one theme card's look from its spec. */
export function Swatches({ spec }: { spec: ThemeSpec }): JSX.Element {
  return (
    <span className="theme-swatches" aria-hidden="true">
      {SWATCHES.map((t) => (
        // A colour Apiary itself re-serialised (see validate.ts), set as a style value — the one
        // place a theme's colour is used outside a custom property.
        <span key={t} className="theme-swatch" style={{ background: spec.palette[t] ?? DEFAULT_PALETTE[t] }} />
      ))}
    </span>
  )
}

export function effectsLabel(spec: ThemeSpec): string {
  const parts = spec.effects.map((e) => EFFECT_NAMES[e.kind] ?? e.kind)
  if (spec.material.kind === 'glass') parts.unshift(spec.material.refraction > 0 ? 'Liquid glass' : 'Frosted glass')
  return parts.length === 0 ? 'No effects' : parts.join(' · ')
}
