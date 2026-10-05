import * as THREE from 'three'
import type { Accessory, BodyShape, PetSpec } from '@shared/pets/spec'
import { BODY_SDF, type Sdf } from './sdf'
import { furry, glossy, meshFromSdf, surfaceZ } from './plush'
import type { PetView } from './frames'

/**
 * A pet in 3D, in parts: the body, a face for each expression, what it wears, and its limbs —
 * each its own object, so each can be rendered as its own layer (render.ts) and moved by CSS.
 * Everything is built from the validated spec; the shapes are Apiary's own.
 */

export const FACES = ['happy', 'love', 'surprised', 'focused', 'sleepy', 'worried', 'open'] as const
export type FaceKey = typeof FACES[number]

/** Eye height on each body (the box is −1..1, y up). */
const EYE_Y: Record<BodyShape, number> = {
  blob: 0.02, bean: 0.06, drop: -0.1, heart: 0.04, star: -0.02, ghost: 0.04, puff: -0.08, cube: 0.02,
}
const EYE_X = 0.19

export interface Anchors {
  sdf: Sdf
  eyeY: number
  top: number
  bottom: number
  /** Where an arm joins, on the right (the left mirrors it). */
  shoulder: THREE.Vector3
  /** Where it joins for a profile: further round the front, so a forward arm reaches the face. */
  sideShoulder: THREE.Vector3
  front: (x: number, y: number) => number
  /** Half the body's width, and its depth from the middle to the front, at a height. */
  widthAt: (y: number) => number
  depthAt: (y: number) => number
}

function march(sdf: Sdf, from: THREE.Vector3, dir: THREE.Vector3): THREE.Vector3 {
  const p = from.clone()
  for (let i = 0; i < 200; i++) {
    if (sdf(p.x, p.y, p.z) < 0.002) return p
    p.addScaledVector(dir, 0.01)
  }
  return p
}

/** How far round from the front a profile's shoulder sits (radians). */
const SIDE_SHOULDER = 0.8

export function anchorsOf(shape: BodyShape): Anchors {
  const sdf = BODY_SDF[shape]
  const eyeY = EYE_Y[shape]
  const top = march(sdf, new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0)).y
  const bottom = march(sdf, new THREE.Vector3(0.2, -1, 0), new THREE.Vector3(0, 1, 0)).y
  const side = march(sdf, new THREE.Vector3(1, eyeY - 0.22, 0.05), new THREE.Vector3(-1, 0, 0))
  const round = new THREE.Vector3(Math.sin(SIDE_SHOULDER), 0, Math.cos(SIDE_SHOULDER))
  const sideShoulder = march(sdf, round.clone().multiplyScalar(1.2).setY(eyeY - 0.22), round.clone().negate())
  return {
    sdf, eyeY, top, bottom, shoulder: side, sideShoulder, front: (x, y) => surfaceZ(sdf, x, y),
    widthAt: (y) => march(sdf, new THREE.Vector3(1, y, 0), new THREE.Vector3(-1, 0, 0)).x,
    depthAt: (y) => surfaceZ(sdf, 0, y),
  }
}

const ink = (spec: PetSpec): THREE.MeshPhysicalMaterial => glossy(spec.eyes.color)
const white = (): THREE.MeshPhysicalMaterial => new THREE.MeshPhysicalMaterial({ color: '#fbfbf6', roughness: 0.25, clearcoat: 0.8, clearcoatRoughness: 0.1 })

function sphere(r: number, mat: THREE.Material, sx = 1, sy = 1, sz = 1): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 40, 24), mat)
  m.scale.set(sx, sy, sz)
  return m
}

/** A curved stroke (closed eyes, a smile, a brow), drawn as a soft tube. */
function arc(points: [number, number][], z: (x: number, y: number) => number, radius: number, mat: THREE.Material): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(points.map(([x, y]) => new THREE.Vector3(x, y, z(x, y) + 0.035)))
  return new THREE.Mesh(new THREE.TubeGeometry(curve, 24, radius, 10, false), mat)
}

function heartShape(): THREE.Shape {
  const s = new THREE.Shape()
  s.moveTo(0, -0.5)
  s.bezierCurveTo(-0.6, -0.1, -0.55, 0.45, -0.25, 0.45)
  s.bezierCurveTo(-0.1, 0.45, 0, 0.32, 0, 0.25)
  s.bezierCurveTo(0, 0.32, 0.1, 0.45, 0.25, 0.45)
  s.bezierCurveTo(0.55, 0.45, 0.6, -0.1, 0, -0.5)
  return s
}

function eye(spec: PetSpec, a: Anchors, x: number, face: FaceKey): THREE.Object3D {
  const g = new THREE.Group()
  const y = a.eyeY
  const z = a.front(x, y)
  if (face === 'sleepy') {
    g.add(arc([[x - 0.075, y + 0.01], [x, y - 0.04], [x + 0.075, y + 0.01]], a.front, 0.016, ink(spec)))
    return g
  }
  if (face === 'love') {
    const heart = new THREE.Mesh(new THREE.ExtrudeGeometry(heartShape(), { depth: 0.08, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.05, bevelSegments: 6, curveSegments: 24 }), glossy('#ff3d7f'))
    heart.scale.setScalar(0.2)
    heart.position.set(x, y, z + 0.02)
    g.add(heart)
    return g
  }
  // Looking up at Claude while it works; wide-eyed when surprised.
  const look = face === 'focused' ? new THREE.Vector2(0.012, 0.035) : new THREE.Vector2(0, 0)
  const big = face === 'surprised' ? 1.18 : 1
  switch (spec.eyes.style) {
    case 'round':
    case 'wide': {
      const tall = spec.eyes.style === 'wide' ? 1.25 : 1.05
      const sclera = sphere(0.1 * big, white(), 1, tall, 0.55)
      sclera.position.set(x, y, z + 0.01)
      const pupil = sphere((face === 'surprised' ? 0.04 : spec.eyes.style === 'wide' ? 0.045 : 0.06), ink(spec), 1, 1.1, 0.6)
      pupil.position.set(x + look.x, y - 0.01 + look.y, z + 0.06)
      g.add(sclera, pupil)
      break
    }
    case 'button':
    case 'sparkle': {
      const r = spec.eyes.style === 'sparkle' ? 0.095 : 0.08
      const ball = sphere(r * big, ink(spec), 0.82, 1.15, 0.55)
      ball.position.set(x + look.x, y + look.y, z + 0.02)
      g.add(ball)
      if (spec.eyes.style === 'sparkle') {
        // A painted catch-light, as on an anime plush.
        const glint = sphere(0.022, new THREE.MeshBasicMaterial({ color: '#ffffff' }))
        glint.position.set(x + look.x - 0.025, y + look.y + 0.04, z + 0.075)
        g.add(glint)
      }
      break
    }
    case 'sleepy': {
      const ball = sphere(0.07, ink(spec), 0.9, 1, 0.55)
      ball.position.set(x + look.x, y - 0.015 + look.y, z + 0.02)
      // A heavy lid of the body's own felt over the top half.
      const lid = sphere(0.085, new THREE.MeshPhysicalMaterial({ color: spec.body.color, roughness: 0.9, sheen: 1, sheenColor: new THREE.Color(spec.body.accent) }), 1, 0.55, 0.6)
      lid.position.set(x, y + 0.035, z + 0.04)
      g.add(ball, lid)
      break
    }
  }
  return g
}

/** The eyes, mouth, cheeks and brows for one expression. */
export function buildFace(spec: PetSpec, a: Anchors, face: FaceKey): THREE.Group {
  const g = new THREE.Group()
  g.add(eye(spec, a, -EYE_X, face), eye(spec, a, EYE_X, face))
  const my = a.eyeY - 0.17
  const mat = ink(spec)
  switch (face) {
    case 'happy':
    case 'love':
      g.add(arc([[-0.06, my + 0.015], [0, my - 0.02], [0.06, my + 0.015]], a.front, 0.013, mat))
      break
    case 'open': {
      const mouth = sphere(0.06, mat, 1.2, 0.8, 0.4)
      mouth.position.set(0, my - 0.01, a.front(0, my) + 0.01)
      const tongue = sphere(0.035, new THREE.MeshPhysicalMaterial({ color: '#ff6f91', roughness: 0.4 }), 1.2, 0.6, 0.4)
      tongue.position.set(0, my - 0.035, a.front(0, my) + 0.04)
      g.add(mouth, tongue)
      break
    }
    case 'surprised': {
      const o = sphere(0.035, mat, 0.9, 1.15, 0.4)
      o.position.set(0, my - 0.01, a.front(0, my) + 0.015)
      g.add(o)
      break
    }
    case 'focused':
      g.add(arc([[-0.035, my], [0.035, my]], a.front, 0.012, mat))
      break
    case 'sleepy': {
      const o = sphere(0.02, mat, 1, 1, 0.5)
      o.position.set(0, my, a.front(0, my) + 0.012)
      g.add(o)
      break
    }
    case 'worried':
      g.add(arc([[-0.06, my - 0.01], [-0.02, my + 0.012], [0.02, my - 0.012], [0.06, my + 0.01]], a.front, 0.011, mat))
      g.add(arc([[-0.27, a.eyeY + 0.17], [-0.12, a.eyeY + 0.13]], a.front, 0.012, mat))
      g.add(arc([[0.27, a.eyeY + 0.17], [0.12, a.eyeY + 0.13]], a.front, 0.012, mat))
      break
  }
  if (spec.cheeks) {
    for (const cx of [-0.32, 0.32]) {
      const cy = a.eyeY - 0.11
      const cheek = sphere(0.06, new THREE.MeshPhysicalMaterial({ color: '#ff6f9c', roughness: 0.9, transparent: true, opacity: face === 'love' ? 0.75 : 0.5 }), 1.3, 0.75, 0.3)
      cheek.position.set(cx, cy, a.front(cx, cy) + 0.03)
      g.add(cheek)
    }
  }
  return g
}

const tint = (hex: string, t: number): THREE.Color => new THREE.Color(hex).lerp(new THREE.Color('#ffffff'), t)

/** Fur for the body, its limbs and anything else felt: one look, so a pet is all of a piece. */
function felt(geometry: THREE.BufferGeometry, color: string, accent: string, texture: PetSpec['body']['texture'], pile = 1): THREE.Group {
  const glossyCoat = texture === 'glossy'
  return furry(geometry, {
    color, sheen: tint(accent, 0.35),
    length: (texture === 'matte' ? 0.045 : glossyCoat ? 0.035 : 0.085) * pile,
    density: texture === 'matte' ? 320 : 250,
    shells: texture === 'fuzzy' ? 32 : 18,
  })
}

export function buildBody(spec: PetSpec, geometry: THREE.BufferGeometry): THREE.Group {
  const g = felt(geometry, spec.body.color, spec.body.accent, spec.body.texture)
  if (spec.body.texture === 'glossy') {
    // A glossy coat: a clear varnish over short felt.
    const coat = new THREE.Mesh(geometry, new THREE.MeshPhysicalMaterial({ color: spec.body.color, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08, transparent: true, opacity: 0.35 }))
    coat.scale.setScalar(1.035)
    g.add(coat)
  }
  return g
}

/** A soft sausage `len` long (between its end centres) and `r` thick, in scene units. */
function capsule(len: number, r: number): THREE.BufferGeometry {
  return meshFromSdf((x, y, z) => {
    const cy = Math.max(-len / 2, Math.min(len / 2, y))
    return Math.hypot(x, y - cy, z) - r
  }, len / 2 + r + 0.08, 32)
}

/**
 * Where the right arm joins (the left mirrors it in x). From the front it is at the body's widest;
 * in profile a little forward of that, so an arm swinging forward reaches what the pet holds.
 */
export function shoulderOf(a: Anchors, view: PetView): THREE.Vector3 {
  return (view === 'front' ? a.shoulder : a.sideShoulder).clone()
}

export function buildArm(spec: PetSpec, a: Anchors, side: 'l' | 'r', view: PetView = 'front'): THREE.Object3D {
  const dir = side === 'l' ? -1 : 1
  const len = (spec.arms === 'noodle' ? 0.2 : spec.arms === 'mitten' ? 0.12 : 0.08) + (view === 'side' ? 0.06 : 0)
  const r = spec.arms === 'noodle' ? 0.035 : 0.065
  const arm = felt(capsule(len, r), new THREE.Color(spec.body.color).multiplyScalar(0.92).getStyle(), spec.body.accent, spec.body.texture, 0.5)
  const g = new THREE.Group()
  g.add(arm)
  if (view === 'side') {
    // Hanging straight down the flank from the shoulder, so the page swings it forward and back.
    const s = shoulderOf(a, view)
    // Standing out from the surface by its own thickness, or the body would hide most of it.
    arm.rotation.z = dir * 0.12
    arm.position.set(dir * (s.x + Math.sin(SIDE_SHOULDER) * r), s.y - len / 2 - r * 0.4, s.z + Math.cos(SIDE_SHOULDER) * r)
    return g
  }
  // Hanging down and a little out from the shoulder.
  arm.rotation.z = dir * (spec.arms === 'noodle' ? 0.5 : 0.75)
  arm.position.set(dir * (a.shoulder.x + 0.02), a.shoulder.y - 0.12, 0.05)
  if (spec.arms === 'mitten') {
    const thumb = felt(capsule(0.02, 0.035), spec.body.color, spec.body.accent, spec.body.texture, 0.5)
    thumb.position.set(dir * (a.shoulder.x + 0.14), a.shoulder.y - 0.12, 0.12)
    g.add(thumb)
  }
  return g
}

export function buildLeg(spec: PetSpec, a: Anchors, side: 'l' | 'r'): THREE.Object3D {
  const x = side === 'l' ? -0.2 : 0.2
  const g = new THREE.Group()
  const shade = new THREE.Color(spec.body.color).multiplyScalar(0.85).getStyle()
  const leg = felt(capsule(0.09, 0.075), shade, spec.body.accent, spec.body.texture, 0.5)
  leg.position.set(x, a.bottom - 0.08, 0.05)
  g.add(leg)
  if (spec.legs === 'feet' || spec.legs === 'boots') {
    const color = spec.legs === 'boots' ? spec.eyes.color : shade
    const foot = sphere(0.1, spec.legs === 'boots' ? glossy(color) : new THREE.MeshPhysicalMaterial({ color, roughness: 0.9, sheen: 1, sheenColor: tint(spec.body.accent, 0.3) }), 1.25, 0.6, 1.4)
    foot.position.set(x * 1.1, a.bottom - 0.2, 0.08)
    g.add(foot)
  }
  return g
}

/** Felt for hats and scarves: the accessory's colour, a little fluffier than the body. */
function hatFelt(sdf: Sdf, color: string, extent = 0.8): THREE.Group {
  return furry(meshFromSdf(sdf, extent, 40), { color, sheen: tint(color, 0.45), length: 0.04, density: 260, shells: 20 })
}

const ellipsoidSdf = (rx: number, ry: number, rz: number): Sdf => (x, y, z) => (Math.hypot(x / rx, y / ry, z / rz) - 1) * Math.min(rx, ry, rz)

function accessory(kind: Accessory, color: string, a: Anchors): THREE.Object3D {
  const g = new THREE.Group()
  const top = a.top
  const eyeZ = a.front(0, a.eyeY)
  switch (kind) {
    case 'beret': {
      const beret = hatFelt(ellipsoidSdf(0.62, 0.2, 0.55), color)
      beret.position.set(-0.06, top - 0.02, -0.02)
      beret.rotation.z = 0.2
      const stalk = sphere(0.045, new THREE.MeshPhysicalMaterial({ color, roughness: 0.8 }), 1, 1.3, 1)
      stalk.position.set(-0.03, top + 0.2, 0)
      g.add(beret, stalk)
      break
    }
    case 'cap': {
      const cloth = new THREE.MeshPhysicalMaterial({ color, roughness: 0.75, sheen: 0.6, sheenColor: tint(color, 0.4) })
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.44, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), cloth)
      dome.scale.set(1, 0.72, 1)
      dome.position.set(0, top - 0.12, 0)
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.035, 48), cloth)
      brim.scale.set(1, 1, 0.75)
      brim.position.set(0.08, top - 0.12, 0.3)
      brim.rotation.x = 0.12
      const button = sphere(0.04, cloth)
      button.position.set(0, top + 0.2, 0)
      g.add(dome, brim, button)
      break
    }
    case 'beanie': {
      const hat = hatFelt((x, y, z) => Math.max(Math.hypot(x / 0.5, y / 0.42, z / 0.48) - 1, -y - 0.02) * 0.45, color)
      hat.position.set(0, top - 0.16, 0)
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.47, 0.06, 16, 64), new THREE.MeshPhysicalMaterial({ color: new THREE.Color(color).multiplyScalar(0.75), roughness: 0.9, sheen: 1, sheenColor: tint(color, 0.3) }))
      band.rotation.x = Math.PI / 2
      band.position.set(0, top - 0.14, 0)
      const pom = hatFelt(ellipsoidSdf(0.14, 0.14, 0.14), tint(color, 0.45).getStyle(), 0.25)
      pom.position.set(0, top + 0.28, 0)
      g.add(hat, band, pom)
      break
    }
    case 'crown': {
      const gold = new THREE.MeshPhysicalMaterial({ color, metalness: 1, roughness: 0.22 })
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.26, 0.1, 40, 1, true), gold)
      ring.position.set(0, top + 0.02, 0)
      g.add(ring)
      for (let i = 0; i < 5; i++) {
        const t = (i / 5) * Math.PI * 2
        const point = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 16), gold)
        point.position.set(Math.sin(t) * 0.24, top + 0.13, Math.cos(t) * 0.24)
        const jewel = sphere(0.025, glossy(i % 2 === 0 ? '#ff2d55' : '#2ec5ff'))
        jewel.position.set(Math.sin(t) * 0.255, top + 0.02, Math.cos(t) * 0.255)
        g.add(point, jewel)
      }
      break
    }
    case 'flower': {
      const petal = new THREE.MeshPhysicalMaterial({ color, roughness: 0.6, sheen: 1, sheenColor: tint(color, 0.5) })
      const f = new THREE.Group()
      for (let i = 0; i < 5; i++) {
        const t = (i / 5) * Math.PI * 2
        const p = sphere(0.07, petal, 1, 1, 0.5)
        p.position.set(Math.cos(t) * 0.075, Math.sin(t) * 0.075, 0)
        f.add(p)
      }
      const centre = sphere(0.05, new THREE.MeshPhysicalMaterial({ color: '#ffe066', roughness: 0.7 }), 1, 1, 0.6)
      centre.position.z = 0.03
      f.add(centre)
      f.position.set(0.3, top - 0.06, a.front(0.3, top - 0.12) * 0.6)
      f.rotation.x = -0.3
      g.add(f)
      break
    }
    case 'headphones': {
      const mat = glossy(color)
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.04, 16, 64, Math.PI), mat)
      band.position.set(0, a.eyeY + 0.05, 0)
      const cushion = new THREE.MeshPhysicalMaterial({ color: '#1d1d24', roughness: 0.6 })
      for (const s of [-1, 1]) {
        const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.12, 32), mat)
        cup.rotation.z = Math.PI / 2
        cup.position.set(s * 0.58, a.eyeY + 0.03, 0)
        const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.05, 32), cushion)
        pad.rotation.z = Math.PI / 2
        pad.position.set(s * 0.52, a.eyeY + 0.03, 0)
        g.add(cup, pad)
      }
      g.add(band)
      break
    }
    case 'round-glasses':
    case 'monocle': {
      const frame = glossy(color)
      const lenses = kind === 'monocle' ? [EYE_X] : [-EYE_X, EYE_X]
      for (const x of lenses) {
        const rim = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.018, 16, 48), frame)
        rim.position.set(x, a.eyeY, eyeZ + 0.12)
        const glass = new THREE.Mesh(new THREE.CircleGeometry(0.125, 40), new THREE.MeshPhysicalMaterial({ color: '#ffffff', transparent: true, opacity: 0.12, roughness: 0.02, clearcoat: 1 }))
        glass.position.copy(rim.position)
        g.add(rim, glass)
      }
      if (kind === 'round-glasses') {
        const bridge = arc([[-0.06, a.eyeY + 0.02], [0, a.eyeY + 0.045], [0.06, a.eyeY + 0.02]], () => eyeZ + 0.085, 0.016, frame)
        g.add(bridge)
      }
      break
    }
    case 'sunglasses': {
      const lens = glossy(color)
      for (const x of [-EYE_X, EYE_X]) {
        const l = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.04, 40), lens)
        l.rotation.x = Math.PI / 2
        l.scale.set(1.12, 1, 0.82)
        l.position.set(x, a.eyeY, eyeZ + 0.1)
        g.add(l)
      }
      const bridge = arc([[-0.07, a.eyeY + 0.03], [0.07, a.eyeY + 0.03]], () => eyeZ + 0.1, 0.018, lens)
      g.add(bridge)
      break
    }
    case 'bowtie': {
      const cloth = new THREE.MeshPhysicalMaterial({ color, roughness: 0.55, sheen: 0.8, sheenColor: tint(color, 0.4) })
      const y = a.bottom + 0.22
      const z = a.front(0, y) + 0.03
      for (const s of [-1, 1]) {
        const wing = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.16, 24), cloth)
        wing.rotation.z = s * Math.PI / 2
        wing.position.set(s * 0.085, y, z)
        wing.scale.set(1, 1, 0.5)
        g.add(wing)
      }
      const knot = sphere(0.04, cloth, 1, 1, 0.7)
      knot.position.set(0, y, z + 0.01)
      g.add(knot)
      break
    }
    case 'scarf': {
      const y = a.bottom + 0.24
      // Snug: as wide as the body is at the neck.
      const w = a.widthAt(y) + 0.04
      const dz = a.depthAt(y) + 0.04
      const scarf = hatFelt((x, yy, z) => {
        const r = Math.hypot(x / w, z / dz) - 1
        return Math.max(Math.abs(r) * 0.5 - 0.06, Math.abs(yy) - 0.06)
      }, color)
      scarf.position.set(0, y, 0.02)
      const tail = hatFelt(ellipsoidSdf(0.08, 0.2, 0.05), color, 0.3)
      tail.position.set(0.2, y - 0.17, a.front(0.2, y) + 0.05)
      tail.rotation.z = 0.25
      g.add(scarf, tail)
      break
    }
  }
  return g
}

export function buildAccessories(spec: PetSpec, a: Anchors): THREE.Group {
  const g = new THREE.Group()
  for (const acc of spec.accessories) g.add(accessory(acc.kind, acc.color, a))
  return g
}
