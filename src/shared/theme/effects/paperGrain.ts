import { hash, type Effect } from './types'

/** A still, faint paper texture over everything. */
export const paperGrain: Effect = {
  layer: 'front',
  maxOpacity: 0.08,
  draw(ctx, { w, h }, { intensity, density, color }) {
    const count = Math.round((w * h) / 350 * (0.3 + density))
    ctx.fillStyle = color
    ctx.globalAlpha = intensity * this.maxOpacity
    for (let i = 0; i < count; i += 1) ctx.fillRect(hash(i, 91) * w, hash(i, 92) * h, 1 + (hash(i, 93) > 0.8 ? 1 : 0), 1)
    ctx.globalAlpha = 1
  },
}
