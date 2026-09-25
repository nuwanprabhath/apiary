import { describe, it, expect } from 'vitest'
import { EFFECTS } from '../../src/shared/theme/effects'
import type { Ctx2D } from '../../src/shared/theme/effects/types'

/** A context that records what was drawn, and the most opaque anything was drawn at. */
function recorder(): Ctx2D & { ops: string[]; maxAlpha: number; painted: number } {
  const r = {
    ops: [] as string[], maxAlpha: 0, painted: 0, alpha: 1,
    get globalAlpha(): number { return r.alpha },
    set globalAlpha(v: number) { r.alpha = v; r.ops.push(`a${v.toFixed(4)}`) },
    fillStyle: '' as unknown, strokeStyle: '' as unknown, lineWidth: 1, font: '',
    note(op: string): void { r.ops.push(op); r.painted += 1; r.maxAlpha = Math.max(r.maxAlpha, r.alpha) },
    fillRect(x: number, y: number, w: number, h: number) { r.note(`r${x.toFixed(1)},${y.toFixed(1)},${w.toFixed(1)},${h.toFixed(1)}`) },
    fillText(t: string, x: number, y: number) { r.note(`t${t}${x.toFixed(1)},${y.toFixed(1)}`) },
    beginPath() { r.ops.push('b') }, moveTo(x: number, y: number) { r.ops.push(`m${x.toFixed(1)},${y.toFixed(1)}`) },
    lineTo(x: number, y: number) { r.ops.push(`l${x.toFixed(1)},${y.toFixed(1)}`) }, stroke() { r.note('s') },
    createRadialGradient() { return { addColorStop() { /* recorded by fill */ } } },
  }
  return r
}

const params = { intensity: 1, speed: 1, density: 1, color: '#00ff00' }

describe('effects catalogue', () => {
  for (const [name, effect] of Object.entries(EFFECTS)) {
    it(`${name} draws at any size without throwing, never above its opacity cap`, () => {
      for (const [w, h] of [[0, 0], [1, 1], [1920, 1080]]) {
        for (const t of [0, 0.5, 13.37]) {
          const ctx = recorder()
          effect.draw(ctx, { t, w, h, still: false }, params)
          expect(ctx.maxAlpha).toBeLessThanOrEqual(effect.maxOpacity + 1e-9)
        }
      }
      const half = recorder()
      effect.draw(half, { t: 2, w: 800, h: 600, still: false }, { ...params, intensity: 0.5 })
      expect(half.maxAlpha).toBeLessThanOrEqual(effect.maxOpacity * 0.5 + 1e-9)
    })

    it(`${name} draws the same frame for the same time — the still frame is exact`, () => {
      const a = recorder()
      const b = recorder()
      effect.draw(a, { t: 0, w: 800, h: 600, still: true }, params)
      effect.draw(b, { t: 0, w: 800, h: 600, still: true }, params)
      expect(a.ops).toEqual(b.ops)
    })
  }

  it('glitch shows in at most one frame in thirty, and never while still', () => {
    let shown = 0
    for (let frame = 0; frame < 30 * 20; frame += 1) {
      const ctx = recorder()
      EFFECTS['glitch-flicker'].draw(ctx, { t: frame / 30, w: 800, h: 600, still: false }, params)
      if (ctx.painted > 0) shown += 1
    }
    expect(shown).toBeLessThanOrEqual(20)
    const still = recorder()
    EFFECTS['glitch-flicker'].draw(still, { t: 0, w: 800, h: 600, still: true }, params)
    expect(still.painted).toBe(0)
  })

  it('keeps the overlays within the caps the design sets', () => {
    expect(EFFECTS.scanlines.maxOpacity).toBeLessThanOrEqual(0.15)
    expect(EFFECTS['crt-vignette'].maxOpacity).toBeLessThanOrEqual(0.35)
    expect(EFFECTS['paper-grain'].maxOpacity).toBeLessThanOrEqual(0.08)
  })
})
