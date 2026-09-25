import { parseColor, rotateHue, toHex8 } from '../color'
import type { Effect } from './types'

/** Hue steps from the effect colour to the other three pools — a wallpaper's worth of colour. */
const HUES = [0, 55, 150, 215] as const

/**
 * The four colours aurora paints with: the effect colour and three companions round the hue
 * wheel. Exported because the readability check has to know what can sit behind glass.
 */
export function auroraColors(color: string): string[] {
  const c = parseColor(color)
  if (c === null) return [color]
  return HUES.map((d) => toHex8({ ...rotateHue(c, d), a: 1 }))
}

/**
 * Large, slow pools of saturated colour, like a macOS wallpaper — what glass panels are for.
 * Much bolder than gradient-drift: it is meant to be seen through blurred panes, not over text.
 */
export const aurora: Effect = {
  layer: 'back',
  maxOpacity: 0.85,
  draw(ctx, { t, w, h }, { intensity, speed, density, color }) {
    const s = t * (0.02 + speed * 0.1)
    const r = Math.max(w, h) * (0.35 + density * 0.35)
    const colors = auroraColors(color)
    ctx.globalAlpha = intensity * this.maxOpacity
    colors.forEach((c, i) => {
      const px = 0.5 + 0.38 * Math.sin(s * (0.7 + i * 0.23) + i * 1.9)
      const py = 0.5 + 0.38 * Math.cos(s * (0.6 + i * 0.17) + i * 2.7)
      const g = ctx.createRadialGradient(px * w, py * h, 0, px * w, py * h, r)
      g.addColorStop(0, c)
      g.addColorStop(1, 'transparent')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
    })
    ctx.globalAlpha = 1
  },
}
