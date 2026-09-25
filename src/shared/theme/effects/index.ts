import type { EffectKind } from '../spec'
import type { Effect } from './types'
import { digitalRain } from './digitalRain'
import { perspectiveGrid } from './perspectiveGrid'
import { starfield } from './starfield'
import { noise } from './noise'
import { gradientDrift } from './gradientDrift'
import { aurora } from './aurora'
import { scanlines } from './scanlines'
import { crtVignette } from './crtVignette'
import { glitchFlicker } from './glitchFlicker'
import { paperGrain } from './paperGrain'

/** Every canvas effect. `neon-glow` is not here: it is CSS on the panels (see cssVars.ts). */
export const EFFECTS: Record<Exclude<EffectKind, 'neon-glow'>, Effect> = {
  'digital-rain': digitalRain,
  'perspective-grid': perspectiveGrid,
  'starfield': starfield,
  'noise': noise,
  'gradient-drift': gradientDrift,
  'aurora': aurora,
  'scanlines': scanlines,
  'crt-vignette': crtVignette,
  'glitch-flicker': glitchFlicker,
  'paper-grain': paperGrain,
}
