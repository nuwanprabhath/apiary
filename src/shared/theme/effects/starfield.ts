import { hash, type Effect } from './types'

/** Slowly drifting, twinkling stars. */
export const starfield: Effect = {
  layer: 'back',
  maxOpacity: 0.8,
  draw(ctx, { t, w, h }, { intensity, speed, density, color }) {
    const count = Math.round((w * h) / 9000 * (0.3 + density))
    ctx.fillStyle = color
    for (let i = 0; i < count; i += 1) {
      const x = (hash(i, 1) * w + t * (2 + speed * 20) * (0.3 + hash(i, 2))) % w
      const y = hash(i, 3) * h
      const twinkle = 0.5 + 0.5 * Math.sin(t * (1 + speed * 3) + hash(i, 4) * 6.28)
      ctx.globalAlpha = intensity * this.maxOpacity * (0.3 + 0.7 * twinkle)
      const r = hash(i, 5) < 0.9 ? 1 : 2
      ctx.fillRect(x, y, r, r)
    }
    ctx.globalAlpha = 1
  },
}
