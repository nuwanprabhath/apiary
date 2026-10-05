import { describe, it, expect } from 'vitest'
import { page } from 'vitest/browser'
import { PetRenderer } from '../../src/renderer/features/pets/render3d/render'
import { STARTER_PET } from '@shared/pets/builtins'
import { validatePet } from '@shared/pets/validate'
import type { PetSpec } from '@shared/pets/spec'
import type { FaceKey } from '../../src/renderer/features/pets/render3d/parts3d'

const pet = (o: object): PetSpec => validatePet({ ...STARTER_PET, ...o })!
const SPECS: [PetSpec, FaceKey][] = [
  [STARTER_PET, 'happy'],
  [pet({ body: { shape: 'bean', color: '#6fdc1e', accent: '#e4ff9a', texture: 'fuzzy' }, eyes: { style: 'round', color: '#0a0a0a' }, arms: 'noodle', legs: 'feet', accessories: [] }), 'happy'],
  [pet({ body: { shape: 'drop', color: '#ffc81a', accent: '#fff3a0', texture: 'fuzzy' }, eyes: { style: 'button', color: '#0a0a0a' }, arms: 'mitten', accessories: [{ kind: 'round-glasses', color: '#111111' }] }), 'sleepy'],
  [pet({ body: { shape: 'heart', color: '#ff1fa8', accent: '#ffa3dc', texture: 'fuzzy' }, accessories: [{ kind: 'sunglasses', color: '#0b0b0b' }] }), 'happy'],
  [pet({ body: { shape: 'puff', color: '#9b5cff', accent: '#e0c8ff', texture: 'matte' }, eyes: { style: 'sparkle', color: '#0a0a0a' }, accessories: [{ kind: 'crown', color: '#ffcc33' }] }), 'love'],
  [pet({ body: { shape: 'cube', color: '#ff5a3c', accent: '#ffc2a8', texture: 'glossy' }, eyes: { style: 'wide', color: '#0a0a0a' }, legs: 'boots', accessories: [{ kind: 'cap', color: '#1f6dff' }, { kind: 'bowtie', color: '#ffd400' }] }), 'surprised'],
  [pet({ body: { shape: 'ghost', color: '#20d3c2', accent: '#c4fff6', texture: 'fuzzy' }, accessories: [{ kind: 'beanie', color: '#ff4f81' }, { kind: 'scarf', color: '#ffd400' }] }), 'open'],
  [pet({ body: { shape: 'star', color: '#ffd400', accent: '#fff6b0', texture: 'fuzzy' }, eyes: { style: 'sleepy', color: '#0a0a0a' }, accessories: [{ kind: 'headphones', color: '#222233' }] }), 'focused'],
]

/**
 * The 3D renderer, in real Chromium (software WebGL here, so slow: a real GPU is far quicker).
 * The screenshot (test-results/pets/gallery3d.png) is for looking at after changing a part.
 */
// Software WebGL is slow enough to starve the rest of the suite, so this is opt-in
// (VITE_PET_GALLERY=1); tests/e2e/pets.spec.ts checks the 3D render on a real GPU, and
// tests/unit/petParts3d builds every part.
const GALLERY = (import.meta as unknown as { env: Record<string, string | undefined> }).env.VITE_PET_GALLERY === '1'

describe.skipIf(!GALLERY)('the 3D pet renderer', () => {
it('renders pets as aligned transparent layers, with their joints inside the frame', { timeout: 120_000 }, async () => {
  const canvas = document.createElement('canvas')
  const r = new PetRenderer(canvas)
  const host = document.createElement('div')
  host.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;padding:16px;background:#14161d;width:1700px'
  document.body.append(host)
  for (const [spec, face] of SPECS) {
    const both = await r.render(spec)
    for (const view of ['front', 'side'] as const) {
      const img = both[view]
      for (const src of [img.body, img.armL, img.armR, img.legL, img.legR, ...Object.values(img.faces)]) expect(src).toMatch(/^data:image\/png;base64,/)
      expect(img.accessories === null).toBe(spec.accessories.length === 0)
      for (const pivot of Object.values(img.pivots)) {
        const [x, y] = pivot.split(' ').map((v) => parseFloat(v))
        expect(x).toBeGreaterThan(0)
        expect(x).toBeLessThan(100)
        expect(y).toBeGreaterThan(0)
        expect(y).toBeLessThan(100)
      }
      expect(img.floor).toBeGreaterThan(0.8)
      expect(img.floor).toBeLessThan(1)
      const cell = document.createElement('div')
      cell.style.cssText = 'position:relative;width:200px;height:200px'
      // Stacked as PetSprite stacks them: in profile the near (left) limbs go in front.
      const order = view === 'front'
        ? [img.legL, img.legR, img.armL, img.body, img.faces[face], img.accessories, img.armR]
        : [img.legR, img.legL, img.armR, img.body, img.faces[face], img.accessories, img.armL]
      for (const src of order) {
        if (src === null) continue
        const el = document.createElement('img')
        el.src = src
        el.style.cssText = 'position:absolute;inset:0;width:100%;height:100%'
        cell.append(el)
      }
      host.append(cell)
    }
  }
  await new Promise((res) => setTimeout(res, 300))
  await page.screenshot({ element: host, path: '../../test-results/pets/gallery3d.png' })
})
})
