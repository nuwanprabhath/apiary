import type { Effect } from './types'

/** CRT scanlines over everything, crawling slowly. */
export const scanlines: Effect = {
  layer: 'front',
  maxOpacity: 0.15,
  draw(ctx, { t, w, h }, { intensity, speed, density, color }) {
    const gap = Math.round(5 - density * 3)
    const shift = Math.floor(t * (speed * 12)) % gap
    ctx.fillStyle = color
    ctx.globalAlpha = intensity * this.maxOpacity
    for (let y = shift; y < h; y += gap) ctx.fillRect(0, y, w, 1)
    ctx.globalAlpha = 1
  },
}
