import { hash, type Effect } from './types'

const GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉ0123456789ABCDEFZ:=*+<>'

/** Falling columns of glyphs, brightest at the head — the Matrix. */
export const digitalRain: Effect = {
  layer: 'back',
  maxOpacity: 0.55,
  draw(ctx, { t, w, h }, { intensity, speed, density, color }) {
    const size = 14
    const step = size * (2.2 - 1.4 * density)
    const trail = 14
    ctx.font = `${String(size)}px monospace`
    ctx.fillStyle = color
    for (let col = 0, x = 0; x < w; col += 1, x += step) {
      const v = 0.35 + hash(col, 1) * 0.9
      const offset = hash(col, 2) * (h + trail * size)
      const head = (offset + t * v * (40 + speed * 220)) % (h + trail * size)
      for (let k = 0; k < trail; k += 1) {
        const y = head - k * size
        if (y < -size || y > h + size) continue
        const tick = Math.floor(t * (4 + speed * 10)) + k
        const glyph = GLYPHS[Math.floor(hash(col * 131 + k, tick) * GLYPHS.length)]
        ctx.globalAlpha = intensity * this.maxOpacity * (1 - k / trail)
        ctx.fillText(glyph, x, y)
      }
    }
    ctx.globalAlpha = 1
  },
}
