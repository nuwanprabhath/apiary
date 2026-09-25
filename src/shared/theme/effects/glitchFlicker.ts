import { hash, type Effect } from './types'

/**
 * A rare, brief tear across the screen. Never more than one visible frame in thirty — at 30 fps
 * that is at most once a second — and never while still, so it can never strobe.
 */
export const glitchFlicker: Effect = {
  layer: 'front',
  maxOpacity: 0.22,
  draw(ctx, { t, w, h, still }, { intensity, speed, density, color }) {
    if (still) return
    const frame = Math.floor(t * 30)
    const window30 = Math.floor(frame / 30)
    // One chosen frame per thirty, and only in some of those windows, depending on speed.
    if (frame % 30 !== Math.floor(hash(window30, 1) * 30)) return
    if (hash(window30, 2) > 0.2 + speed * 0.8) return
    ctx.fillStyle = color
    ctx.globalAlpha = intensity * this.maxOpacity
    const bars = 1 + Math.floor(density * 4)
    for (let i = 0; i < bars; i += 1) {
      ctx.fillRect(hash(frame, i) * w * 0.3, hash(frame, i + 10) * h, w * (0.3 + hash(frame, i + 20) * 0.7), 2 + hash(frame, i + 30) * 6)
    }
    ctx.globalAlpha = 1
  },
}
