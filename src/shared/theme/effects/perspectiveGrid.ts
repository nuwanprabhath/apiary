import type { Effect } from './types'

/** A synthwave floor: lines converging on a horizon, rolling toward you. */
export const perspectiveGrid: Effect = {
  layer: 'back',
  maxOpacity: 0.45,
  draw(ctx, { t, w, h }, { intensity, speed, density, color }) {
    const horizon = h * 0.55
    ctx.strokeStyle = color
    ctx.lineWidth = 1
    ctx.globalAlpha = intensity * this.maxOpacity
    const verticals = Math.round(10 + density * 30)
    ctx.beginPath()
    for (let i = -verticals; i <= verticals; i += 1) {
      ctx.moveTo(w / 2 + (i / verticals) * w * 0.08, horizon)
      ctx.lineTo(w / 2 + (i / verticals) * w * 1.6, h)
    }
    const rows = Math.round(8 + density * 14)
    const phase = (t * (0.1 + speed * 0.6)) % 1
    for (let r = 0; r < rows; r += 1) {
      const d = ((r + phase) / rows) ** 2.2
      const y = horizon + d * (h - horizon)
      ctx.moveTo(0, y)
      ctx.lineTo(w, y)
    }
    ctx.stroke()
    ctx.globalAlpha = 1
  },
}
