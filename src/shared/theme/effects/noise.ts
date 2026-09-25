import { hash, type Effect } from './types'

/** Fine film grain behind the panels. */
export const noise: Effect = {
  layer: 'back',
  maxOpacity: 0.12,
  draw(ctx, { t, w, h }, { intensity, speed, density, color }) {
    const count = Math.round((w * h) / 600 * (0.3 + density))
    const seed = Math.floor(t * (2 + speed * 20))
    ctx.fillStyle = color
    ctx.globalAlpha = intensity * this.maxOpacity
    for (let i = 0; i < count; i += 1) ctx.fillRect(hash(i, seed) * w, hash(i + 7, seed) * h, 1, 1)
    ctx.globalAlpha = 1
  },
}
