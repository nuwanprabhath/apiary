import * as THREE from 'three'
import { MarchingCubes } from 'three/examples/jsm/objects/MarchingCubes.js'
import type { Sdf } from './sdf'

/**
 * Felt and fur for the pets, and the meshes they cover.
 *
 * Fur is drawn with shells: the same mesh drawn again and again, each copy pushed a little further
 * out along its normals, keeping only the fibres a noise says are that long. The innermost shells
 * are darker (light does not reach the bottom of a pile), the outermost catch the light — which is
 * what makes a pile of fibres read as plush rather than as a matte ball with a noisy edge.
 */

/** Grid cells across a mesh's box: fine for the body, coarser for small parts (which are small). */
const MESH_RES = 56

/**
 * A smooth mesh of where `sdf` is negative, sampled in the box −extent..extent of its own units —
 * a small part (an arm, a scarf) asks for a small box, so it gets the same grid as the body.
 */
export function meshFromSdf(sdf: Sdf, extent = 1, res = MESH_RES): THREE.BufferGeometry {
  const mc = new MarchingCubes(res, new THREE.MeshBasicMaterial(), false, false, 120_000)
  mc.isolation = 80
  const n = res
  for (let z = 0; z < n; z++) {
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const px = (x - n / 2) / (n / 2)
        const py = (y - n / 2) / (n / 2)
        const pz = (z - n / 2) / (n / 2)
        // Inside (negative distance) is above the isolation level; the gradient gives the normals.
        mc.field[x + y * n + z * n * n] = 80 - (sdf(px * extent, py * extent, pz * extent) / extent) * 400
      }
    }
  }
  mc.update()
  const count = mc.count
  const src = mc.geometry
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute((src.getAttribute('position').array as Float32Array).slice(0, count * 3), 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute((src.getAttribute('normal').array as Float32Array).slice(0, count * 3), 3))
  // Marching cubes leaves the field's raw gradient as the normal; everything below wants unit
  // normals (an unnormalised one made the whole underside black — a band across every body).
  geometry.normalizeNormals()
  geometry.scale(extent, extent, extent)
  // Ambient occlusion, from the shape itself: a point with more of the body close around it
  // (a crease, the underside) gets less light, as the bottom of a pile does.
  const pos = geometry.getAttribute('position')
  const nor = geometry.getAttribute('normal')
  const ao = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    const nx = nor.getX(i)
    const ny = nor.getY(i)
    const nz = nor.getZ(i)
    let occ = 0
    for (const d of [0.05, 0.1, 0.2, 0.32]) occ += Math.max(0, d - sdf(x + nx * d, y + ny * d, z + nz * d)) / d
    // The underside sits in its own shadow too.
    const v = Math.min(1, Math.max(0.35, 1 - occ * 0.22 - Math.max(0, -ny) * 0.25))
    ao[i * 3] = v
    ao[i * 3 + 1] = v
    ao[i * 3 + 2] = v
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(ao, 3))
  src.dispose()
  return geometry
}

/** Where the surface is, looking straight at the pet from the front at (x, y): for eyes and mouths. */
export function surfaceZ(sdf: Sdf, x: number, y: number): number {
  let z = 1
  for (let i = 0; i < 80 && z > -1; i++) {
    const d = sdf(x, y, z)
    if (d < 0.002) return z
    z -= Math.max(0.004, d * 0.8)
  }
  return 0
}

export interface FurOptions {
  color: THREE.ColorRepresentation
  /** Lighter colour the fibre tips catch. */
  sheen: THREE.ColorRepresentation
  /** How long the fibres are, in scene units. */
  length: number
  /** Fibres per unit: higher is finer. */
  density: number
  shells: number
}

// pcg3d: an integer hash with no pattern along any axis. (A float hash built on x·y·z was tried
// first and went bald along y = 0, where the product is always near zero.)
const FUR_GLSL = /* glsl */ `
  float furHash(vec3 p) {
    uvec3 v = uvec3(ivec3(floor(p)) + 32768);
    v = v * 1664525u + 1013904223u;
    v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
    v ^= v >> 16u;
    v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
    return float(v.x & 0xffffu) / 65535.0;
  }
`

/** One shell of a fur coat: `layer` 0 is the skin, 1 the tips. */
function furMaterial(o: FurOptions, layer: number): THREE.MeshPhysicalMaterial {
  const shade = 0.42 + 0.58 * Math.pow(layer, 0.8)
  const m = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(o.color).multiplyScalar(shade),
    vertexColors: true,
    roughness: 0.92,
    metalness: 0,
    sheen: 1,
    sheenColor: new THREE.Color(o.sheen).multiplyScalar(0.35 + 0.65 * layer),
    sheenRoughness: 0.45,
  })
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uShell = { value: layer * o.length }
    shader.uniforms.uLayer = { value: layer }
    shader.uniforms.uDensity = { value: o.density }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uShell;\nvarying vec3 vFurPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normalize(objectNormal) * uShell;\n// Combed: the tips droop a little, as fibres do.\ntransformed.y -= uShell * uShell * 4.0;\nvFurPos = position;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uLayer;\nuniform float uDensity;\nvarying vec3 vFurPos;\n${FUR_GLSL}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        if (uLayer > 0.0) {
          // Each fibre has its own length; fewer reach each shell further out, so they taper.
          float fibre = furHash(vFurPos * uDensity);
          if (fibre < uLayer * 0.92 + 0.04) discard;
        }`)
  }
  // Each layer compiles to a program of its own only because the uniforms differ; the cache key
  // keeps them apart.
  m.customProgramCacheKey = () => `fur-${String(layer > 0)}`
  return m
}

/** A furry mesh: the skin and its shells, as one group. */
export function furry(geometry: THREE.BufferGeometry, o: FurOptions): THREE.Group {
  const group = new THREE.Group()
  for (let i = 0; i <= o.shells; i++) {
    const mesh = new THREE.Mesh(geometry, furMaterial(o, i / o.shells))
    mesh.renderOrder = i
    group.add(mesh)
  }
  return group
}

/** Glossy black, like the eyes of a plush toy: mostly reflection. */
export function glossy(color: THREE.ColorRepresentation): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ color, roughness: 0.12, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04 })
}
