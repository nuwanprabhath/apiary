import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { ACCESSORIES, ARMS, BODY_SHAPES, EYE_STYLES, LEGS, slotOf } from '@shared/pets/spec'
import { STARTER_PET } from '@shared/pets/builtins'
import { validatePet } from '@shared/pets/validate'
import { FACES, anchorsOf, buildAccessories, buildArm, buildBody, buildFace, buildLeg } from '../../src/renderer/features/pets/render3d/parts3d'
import { meshFromSdf } from '../../src/renderer/features/pets/render3d/plush'
import { BODY_SDF } from '../../src/renderer/features/pets/render3d/sdf'
import { HELD_PROPS, SCENERY, buildHeld, buildScenery } from '../../src/renderer/features/pets/render3d/props'

/** Every part the 3D renderer can build, built — no GPU needed for geometry. */
function triangles(o: THREE.Object3D): number {
  let n = 0
  o.traverse((m) => { if (m instanceof THREE.Mesh) n += (m.geometry as THREE.BufferGeometry).getAttribute('position').count / 3 })
  return n
}

describe('the 3D pet parts', () => {
  it('meshes every body as one closed, outward-facing surface that stands on its feet', () => {
    for (const shape of BODY_SHAPES) {
      const g = meshFromSdf(BODY_SDF[shape])
      const p = g.getAttribute('position')
      const n = g.getAttribute('normal')
      expect(p.count).toBeGreaterThan(3000)
      let outward = 0
      for (let i = 0; i < p.count; i++) outward += p.getX(i) * n.getX(i) + p.getY(i) * n.getY(i) + p.getZ(i) * n.getZ(i) > 0 ? 1 : 0
      expect(outward / p.count).toBeGreaterThan(0.9)
      const a = anchorsOf(shape)
      expect(a.top).toBeGreaterThan(a.eyeY)
      expect(a.bottom).toBeLessThan(a.eyeY)
    }
  })

  it('builds every face, eye style, limb and accessory on every body', () => {
    for (const [i, shape] of BODY_SHAPES.entries()) {
      const used = new Set<string>()
      const accessories = ACCESSORIES.filter((k) => { const s = slotOf(k); if (used.has(s)) return false; used.add(s); return true })
      const spec = validatePet({
        ...STARTER_PET,
        body: { ...STARTER_PET.body, shape, texture: (['fuzzy', 'glossy', 'matte'] as const)[i % 3] },
        eyes: { style: EYE_STYLES[i % EYE_STYLES.length], color: '#111111' },
        arms: ARMS[i % ARMS.length], legs: LEGS[i % LEGS.length], accessories: accessories.map((kind) => ({ kind, color: '#ff0000' })),
      })!
      const a = anchorsOf(shape)
      expect(triangles(buildBody(spec, meshFromSdf(BODY_SDF[shape])))).toBeGreaterThan(0)
      for (const face of FACES) expect(triangles(buildFace(spec, a, face))).toBeGreaterThan(0)
      for (const side of ['l', 'r'] as const) {
        expect(triangles(buildArm(spec, a, side))).toBeGreaterThan(0)
        expect(triangles(buildLeg(spec, a, side))).toBeGreaterThan(0)
      }
    }
    for (const kind of ACCESSORIES) {
      const spec = validatePet({ ...STARTER_PET, accessories: [{ kind, color: '#00ff00' }] })!
      expect(triangles(buildAccessories(spec, anchorsOf('blob')))).toBeGreaterThan(0)
    }
  })

  it('builds every prop a pet can hold, and every piece of scenery', () => {
    const empty = [...HELD_PROPS.filter((k) => triangles(buildHeld(k)) === 0), ...SCENERY.filter((k) => triangles(buildScenery(k)) === 0)]
    expect(empty).toEqual([])
  })
})
