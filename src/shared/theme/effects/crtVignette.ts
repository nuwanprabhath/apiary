import type { Effect } from './types'

/** Darkened corners, like the curve of an old tube. Motionless. */
export const crtVignette: Effect = {
  layer: 'front',
  maxOpacity: 0.35,
  draw(ctx, { w, h }, { intensity, density }) {
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * (0.55 - density * 0.25), w / 2, h / 2, Math.max(w, h) * 0.75)
    g.addColorStop(0, 'rgba(0,0,0,0)')
    g.addColorStop(1, 'rgba(0,0,0,1)')
    ctx.globalAlpha = intensity * this.maxOpacity
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
    ctx.globalAlpha = 1
  },
}
