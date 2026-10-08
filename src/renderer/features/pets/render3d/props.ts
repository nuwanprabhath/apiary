import * as THREE from 'three'
import { furry, glossy, meshFromSdf } from './plush'
import type { Sdf } from './sdf'
import { SIDE_TURN, type HeldProp, type SceneryProp } from './frames'

/**
 * Things pets hold, use and play with, and the scenery scenes bring out — Apiary's own, built
 * here, rendered once (render.ts `renderProps`) and kept. Props held by a pet are framed exactly
 * like the pets (same camera, a pet's hands at about x ±0.6, y −0.2, its lap at y −0.4), so a
 * prop image stacks on any pet; scenery is framed on its own.
 */

export { HELD_PROPS, PROP_VIEW, type HeldProp } from './frames'
export const SCENERY = ['pond', 'tree', 'picnic', 'ball'] as const satisfies readonly SceneryProp[]
export { SCENERY_FRAME, type SceneryProp } from './frames'

const mat = (color: THREE.ColorRepresentation, o: Partial<THREE.MeshPhysicalMaterialParameters> = {}): THREE.MeshPhysicalMaterial =>
  new THREE.MeshPhysicalMaterial({ color, roughness: 0.55, ...o })

function box(w: number, h: number, d: number, m: THREE.Material, r = 0.02): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(w, h, d, 4, 4, 4)
  // Round the corners a little: nothing in a pet's world is sharp.
  const p = geometry.getAttribute('position')
  const v = new THREE.Vector3()
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i)
    const cx = Math.max(Math.abs(v.x) - (w / 2 - r), 0) * Math.sign(v.x)
    const cy = Math.max(Math.abs(v.y) - (h / 2 - r), 0) * Math.sign(v.y)
    const cz = Math.max(Math.abs(v.z) - (d / 2 - r), 0) * Math.sign(v.z)
    const corner = new THREE.Vector3(cx, cy, cz)
    if (corner.length() > r) {
      corner.setLength(r)
      v.set(Math.sign(v.x) * (w / 2 - r) + corner.x, Math.sign(v.y) * (h / 2 - r) + corner.y, Math.sign(v.z) * (d / 2 - r) + corner.z)
      p.setXYZ(i, v.x, v.y, v.z)
    }
  }
  geometry.computeVertexNormals()
  return new THREE.Mesh(geometry, m)
}

function ball(r: number, m: THREE.Material, sx = 1, sy = 1, sz = 1): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 40, 24), m)
  mesh.scale.set(sx, sy, sz)
  return mesh
}

function tube(points: [number, number, number][], r: number, m: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p))), 48, r, 10, false), m)
}

function feltBlob(sdf: Sdf, extent: number, color: string, sheen: string): THREE.Group {
  return furry(meshFromSdf(sdf, extent, 44), { color, sheen, length: 0.05, density: 230, shells: 22 })
}

/** A prop a pet holds or sits in, in the pets' own frame. */
export function buildHeld(kind: HeldProp): THREE.Object3D {
  const g = new THREE.Group()
  switch (kind) {
    case 'laptop': {
      // Open on the pet's lap, its screen towards the pet: we see the back of the lid, logo aglow.
      const shell = mat('#aab2c3', { metalness: 0.6, roughness: 0.3 })
      const base = box(0.5, 0.04, 0.38, shell)
      base.position.set(0, -0.4, 0.62)
      const keys = box(0.44, 0.01, 0.24, mat('#2b2f3a', { roughness: 0.6 }), 0.004)
      keys.position.set(0, -0.378, 0.6)
      const lid = new THREE.Group()
      const back = box(0.5, 0.36, 0.028, shell)
      back.position.y = 0.18
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.3), new THREE.MeshBasicMaterial({ color: '#7fd4ff', side: THREE.DoubleSide }))
      screen.position.set(0, 0.18, -0.016)
      const logo = ball(0.04, new THREE.MeshBasicMaterial({ color: '#ffffff' }), 1, 1, 0.3)
      logo.position.set(0, 0.19, 0.016)
      lid.add(back, screen, logo)
      lid.position.set(0, -0.39, 0.81)
      lid.rotation.x = 0.22
      g.add(base, keys, lid)
      break
    }
    case 'dumbbells': {
      const iron = mat('#2b2f3a', { metalness: 0.7, roughness: 0.35 })
      const grip = mat('#ff5a5a', { roughness: 0.4 })
      for (const s of [-1, 1]) {
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.36, 16), grip)
        bar.rotation.z = Math.PI / 2
        bar.position.set(s * 0.72, -0.2, 0.25)
        const w1 = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.08, 28), iron)
        w1.rotation.z = Math.PI / 2
        w1.position.set(s * 0.72 - 0.17, -0.2, 0.25)
        const w2 = w1.clone()
        w2.position.x = s * 0.72 + 0.17
        g.add(bar, w1, w2)
      }
      break
    }
    case 'donut': {
      const dough = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.055, 24, 48), mat('#e2a35a', { roughness: 0.7 }))
      const icing = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.058, 24, 48, Math.PI * 2), mat('#ff7eb6', { roughness: 0.25, clearcoat: 1 }))
      icing.scale.set(1, 1, 0.75)
      icing.position.z = 0.012
      const donut = new THREE.Group()
      donut.add(dough, icing)
      for (let i = 0; i < 14; i++) {
        const t = (i / 14) * Math.PI * 2
        const sprinkle = new THREE.Mesh(new THREE.CapsuleGeometry(0.006, 0.02, 4, 8), new THREE.MeshBasicMaterial({ color: ['#ffffff', '#ffe066', '#6fdcff', '#9b5cff'][i % 4] }))
        sprinkle.position.set(Math.cos(t) * (0.1 + (i % 3) * 0.015), Math.sin(t) * (0.1 + (i % 3) * 0.015), 0.07)
        sprinkle.rotation.z = t * 3
        donut.add(sprinkle)
      }
      // Held up before the mouth, turned to us: a donut reads best face on.
      donut.position.set(-0.08, -0.2, 0.62)
      donut.rotation.y = -SIDE_TURN + 0.25
      g.add(donut)
      break
    }
    case 'juice': {
      // Held up to the mouth, the straw in it.
      const pack = new THREE.Group()
      const carton = box(0.13, 0.2, 0.09, mat('#ffb21a', { roughness: 0.5 }), 0.015)
      const label = new THREE.Mesh(new THREE.CircleGeometry(0.04, 24), new THREE.MeshBasicMaterial({ color: '#ff6a00' }))
      label.position.z = 0.046
      pack.add(carton, label)
      pack.position.set(-0.1, -0.26, 0.64)
      pack.rotation.y = -SIDE_TURN + 0.2
      pack.rotation.x = 0.15
      const straw = tube([[-0.1, -0.16, 0.64], [-0.08, -0.1, 0.6], [-0.03, -0.13, 0.5]], 0.009, mat('#ff4f81'))
      g.add(pack, straw)
      break
    }
    case 'ropeUp':
    case 'ropeDown': {
      const rope = mat('#ff4f81', { roughness: 0.6 })
      const handle = mat('#ffd400', { roughness: 0.4 })
      const y = kind === 'ropeUp' ? 0.95 : -0.92
      const z = kind === 'ropeUp' ? -0.1 : 0.35
      g.add(tube([[-0.68, -0.2, 0.15], [-0.6, y * 0.6, z], [0, y, z], [0.6, y * 0.6, z], [0.68, -0.2, 0.15]], 0.012, rope))
      for (const s of [-1, 1]) {
        const h = new THREE.Mesh(new THREE.CapsuleGeometry(0.025, 0.08, 4, 12), handle)
        h.position.set(s * 0.7, -0.22, 0.15)
        g.add(h)
      }
      break
    }
    case 'racket': {
      const frame = mat('#2ec5ff', { roughness: 0.3, clearcoat: 1 })
      const head = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.018, 16, 48), frame)
      head.scale.set(0.8, 1, 1)
      head.position.set(0.82, 0.12, 0.2)
      const strings = new THREE.Mesh(new THREE.CircleGeometry(0.14, 32), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35 }))
      strings.scale.set(0.8, 1, 1)
      strings.position.copy(head.position)
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.022, 0.28, 16), mat('#1d1d24'))
      handle.position.set(0.75, -0.13, 0.2)
      handle.rotation.z = 0.3
      g.add(head, strings, handle)
      break
    }
    case 'rod': {
      // Out over the water ahead, the line straight down into it.
      const rod = tube([[-0.3, -0.42, 0.42], [-0.22, 0.05, 0.72], [-0.14, 0.5, 1.0]], 0.014, mat('#8b5a2b', { roughness: 0.7 }))
      const line = tube([[-0.14, 0.5, 1.0], [-0.14, 0.0, 1.0], [-0.14, -0.62, 1.0]], 0.003, new THREE.MeshBasicMaterial({ color: '#e8edff' }))
      const bob = ball(0.035, mat('#ff3b3b', { clearcoat: 1 }))
      bob.position.set(-0.14, -0.64, 1.0)
      const reel = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.03, 20), mat('#c9ccd6', { metalness: 0.7 }))
      reel.rotation.z = Math.PI / 2
      reel.position.set(-0.32, -0.32, 0.47)
      g.add(rod, line, bob, reel)
      break
    }
    case 'fish': {
      const fish = new THREE.Group()
      const body = ball(0.14, mat('#ff9f1c', { roughness: 0.3, clearcoat: 1 }), 1.5, 0.8, 0.5)
      const tail = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.14, 3), mat('#ff7a00', { roughness: 0.35 }))
      tail.rotation.z = Math.PI / 2
      tail.position.x = -0.25
      const eye = ball(0.022, glossy('#111111'))
      eye.position.set(0.13, 0.03, 0.06)
      fish.add(body, tail, eye)
      fish.position.set(0.15, 0.62, 0.35)
      fish.rotation.z = 0.5
      g.add(fish)
      break
    }
    case 'car': {
      // A little open-top car, nose forward: the pet sits in it, its legs hidden by the doors.
      const paint = mat('#ff3b3b', { roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.05 })
      const bodyGeo = meshFromSdf((x, y, z) => {
        // A rounded tub with a bonnet in front: a toy, not a box.
        const tub = Math.hypot(x / 0.4, y / 0.26, z / 0.62) - 1
        const bonnet = Math.hypot(x / 0.34, (y + 0.02) / 0.2, (z - 0.45) / 0.34) - 1
        const seat = Math.hypot(x / 0.3, (y - 0.3) / 0.14, (z + 0.02) / 0.36) - 1
        return Math.max(Math.min(tub, bonnet) * 0.2, -seat * 0.2)
      }, 0.85, 48)
      const car = new THREE.Mesh(bodyGeo, paint)
      car.position.set(0, -0.56, 0)
      g.add(car)
      g.scale.setScalar(1.15)
      g.position.y = 0.11
      for (const z of [-0.42, 0.5]) {
        for (const x of [-0.36, 0.36]) {
          const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.06, 16, 32), mat('#1d1d24', { roughness: 0.8 }))
          wheel.rotation.y = Math.PI / 2
          wheel.position.set(x, -0.78, z)
          const hub = ball(0.05, mat('#e8edff', { metalness: 0.8, roughness: 0.2 }), 0.4, 1, 1)
          hub.position.set(x * 1.06, -0.78, z)
          g.add(wheel, hub)
        }
      }
      for (const x of [-0.18, 0.18]) {
        const lamp = ball(0.05, new THREE.MeshBasicMaterial({ color: '#fff3b0' }), 1, 1, 0.5)
        lamp.position.set(x, -0.55, 0.8)
        g.add(lamp)
      }
      const wheelRim = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.015, 12, 32), mat('#1d1d24'))
      wheelRim.position.set(-0.05, -0.28, 0.38)
      wheelRim.rotation.x = -0.6
      g.add(wheelRim)
      break
    }
    case 'skateboard': {
      // Under the pet's feet, nose forward, kicked up at both ends.
      const deck = mat('#9b5cff', { roughness: 0.35, clearcoat: 0.8 })
      const board = box(0.26, 0.035, 0.62, deck, 0.015)
      board.position.set(0, -0.79, 0.05)
      g.add(board)
      for (const s of [-1, 1]) {
        const kick = box(0.26, 0.035, 0.16, deck, 0.015)
        kick.position.set(0, -0.765, 0.05 + s * 0.37)
        kick.rotation.x = -s * 0.45
        g.add(kick)
        for (const x of [-0.1, 0.1]) {
          const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.04, 20), mat('#ffd400', { roughness: 0.4 }))
          wheel.rotation.z = Math.PI / 2
          wheel.position.set(x, -0.85, 0.05 + s * 0.2)
          g.add(wheel)
        }
      }
      break
    }
    case 'easel': {
      // A painting in progress, turned to show us, on a little easel ahead of the pet.
      const wood = mat('#b5793d', { roughness: 0.75 })
      const stand = new THREE.Group()
      for (const [x, z] of [[-0.18, 0], [0.18, 0], [0, -0.16]] as const) {
        stand.add(tube([[0, 0.05, 0], [x, -0.62, z]], 0.014, wood))
      }
      const ledge = box(0.44, 0.025, 0.06, wood, 0.01)
      ledge.position.set(0, -0.18, 0.03)
      let picture: THREE.Material = mat('#fdfaf2', { roughness: 0.9 })
      if (typeof OffscreenCanvas !== 'undefined') {
        const c = new OffscreenCanvas(64, 56)
        const ctx = c.getContext('2d')
        if (ctx !== null) {
          ctx.fillStyle = '#fdfaf2'
          ctx.fillRect(0, 0, 64, 56)
          // A sunny hill: sky, a sun, a hill, a flower.
          ctx.fillStyle = '#9fdcff'; ctx.fillRect(4, 4, 56, 30)
          ctx.fillStyle = '#ffd400'; ctx.beginPath(); ctx.arc(46, 15, 7, 0, Math.PI * 2); ctx.fill()
          ctx.fillStyle = '#5bd65b'; ctx.beginPath(); ctx.ellipse(26, 52, 34, 22, 0, Math.PI, 0); ctx.fill()
          ctx.fillStyle = '#ff3fae'; ctx.beginPath(); ctx.arc(18, 34, 4, 0, Math.PI * 2); ctx.fill()
          const texture = new THREE.CanvasTexture(c)
          texture.colorSpace = THREE.SRGBColorSpace
          picture = new THREE.MeshPhysicalMaterial({ map: texture, roughness: 0.85 })
        }
      }
      const canvas = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.38), picture)
      canvas.position.set(0, 0.02, 0.06)
      const backing = box(0.46, 0.4, 0.02, mat('#e9dcc4', { roughness: 0.9 }), 0.006)
      backing.position.set(0, 0.02, 0.04)
      stand.add(ledge, backing, canvas)
      stand.position.set(0.05, -0.22, 0.98)
      // Facing back towards the pet, and round to us.
      stand.rotation.y = -SIDE_TURN - 0.75
      g.add(stand)
      break
    }
    case 'brush': {
      const brush = new THREE.Group()
      brush.add(tube([[0, -0.16, 0], [0, 0.16, 0]], 0.02, mat('#ffcc33', { roughness: 0.4 })))
      const tip = ball(0.036, mat('#ff3fae', { roughness: 0.5 }), 1, 1.8, 1)
      tip.position.y = 0.2
      brush.add(tip)
      brush.position.set(-0.2, -0.22, 0.6)
      brush.rotation.x = 0.9
      g.add(brush)
      break
    }
    case 'parachute': {
      const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.85, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2.6), new THREE.MeshPhysicalMaterial({ color: '#ff4f81', roughness: 0.6, side: THREE.DoubleSide, sheen: 1, sheenColor: new THREE.Color('#ffd6e5') }))
      canopy.position.set(0, 0.55, 0)
      canopy.scale.set(1, 0.7, 0.8)
      g.add(canopy)
      for (let i = 0; i < 6; i++) {
        const t = (i / 6) * Math.PI * 2
        g.add(tube([[Math.cos(t) * 0.7, 0.86, Math.sin(t) * 0.55], [Math.cos(t) * 0.2, 0.3, Math.sin(t) * 0.12]], 0.004, new THREE.MeshBasicMaterial({ color: '#f4f4f4' })))
      }
      break
    }
    case 'book': {
      // Held open towards the pet: we see its covers and spine, and the pet peeks over the top.
      const cover = mat('#3b6cff', { roughness: 0.6 })
      const page = mat('#fdf6e3', { roughness: 0.9 })
      for (const s of [-1, 1]) {
        const half = new THREE.Group()
        const board = box(0.24, 0.3, 0.022, cover, 0.01)
        board.position.x = s * 0.12
        // The pages, behind the cover and a little lower, so only their top edge shows.
        const leaf = box(0.22, 0.27, 0.05, page, 0.006)
        leaf.position.set(s * 0.115, -0.005, -0.035)
        const stripe = box(0.17, 0.03, 0.006, mat('#ffcc33', { roughness: 0.35, metalness: 0.4 }), 0.003)
        stripe.position.set(s * 0.12, 0.07, 0.013)
        half.add(board, leaf, stripe)
        half.rotation.y = s * 0.38
        g.add(half)
      }
      const spine = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.3, 16), mat('#2a52d6', { roughness: 0.55 }))
      spine.position.z = 0.005
      g.add(spine)
      for (const o of g.children) o.position.add(new THREE.Vector3(0, -0.3, 0.62))
      break
    }
  }
  return g
}

export function buildScenery(kind: SceneryProp): THREE.Object3D {
  const g = new THREE.Group()
  switch (kind) {
    case 'pond': {
      const water = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.MeshPhysicalMaterial({ color: '#2a9df4', roughness: 0.05, clearcoat: 1, metalness: 0.1 }))
      water.scale.set(1.15, 0.38, 1)
      water.rotation.x = -Math.PI / 2 + 0.35
      water.position.set(0, -0.48, 0)
      g.add(water)
      const stone = mat('#9aa3b2', { roughness: 0.85 })
      for (let i = 0; i < 18; i++) {
        const t = (i / 18) * Math.PI * 2
        const s = ball(0.09 + (i % 3) * 0.02, stone, 1.3, 0.7, 1)
        s.position.set(Math.cos(t) * 1.2, -0.5 + Math.sin(t) * 0.14, Math.sin(t) * 0.38)
        g.add(s)
      }
      const pad = new THREE.Mesh(new THREE.CircleGeometry(0.16, 24, 0.3, Math.PI * 1.8), mat('#45c46a', { roughness: 0.6 }))
      pad.rotation.x = -Math.PI / 2 + 0.35
      pad.position.set(0.45, -0.46, 0.05)
      g.add(pad)
      for (const x of [-0.95, -0.85, 0.9]) {
        const reed = tube([[x, -0.5, -0.2], [x + 0.02, -0.2, -0.22], [x - 0.02, 0.0, -0.2]], 0.014, mat('#3fae5a'))
        const tip = ball(0.035, mat('#7a4a22'), 1, 2.4, 1)
        tip.position.set(x - 0.02, 0.04, -0.2)
        g.add(reed, tip)
      }
      break
    }
    case 'tree': {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.17, 1.3, 24), mat('#8b5a2b', { roughness: 0.9 }))
      trunk.position.set(0, -0.0, -0.2)
      g.add(trunk)
      const canopy = feltBlob((x, y, z) => {
        let d = Math.hypot(x / 0.75, y / 0.55, z / 0.6) - 1
        for (const [cx, cy, r] of [[-0.45, -0.1, 0.42], [0.45, -0.05, 0.45], [0, 0.35, 0.45]] as const) d = Math.min(d, Math.hypot(x - cx, y - cy, z) / r - 1)
        return d * 0.4
      }, 1.25, '#3fbf5a', '#c8ffb0')
      canopy.position.set(0, 1.25, -0.2)
      canopy.scale.setScalar(1.35)
      g.add(canopy)
      for (const [x, y] of [[-0.5, 1.0], [0.4, 1.45], [0.1, 1.05], [-0.15, 1.6]] as const) {
        const apple = ball(0.08, mat('#ff3b3b', { clearcoat: 1, roughness: 0.25 }))
        apple.position.set(x, y, 0.62)
        g.add(apple)
      }
      break
    }
    case 'picnic': {
      // A gingham blanket, drawn on a canvas (plain cloth where there is no canvas, as in Node), and a basket.
      let texture: THREE.Texture | null = null
      if (typeof OffscreenCanvas !== 'undefined') {
        const size = 64
        const canvas = new OffscreenCanvas(size, size)
        const ctx = canvas.getContext('2d')
        if (ctx !== null) {
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(0, 0, size, size)
          ctx.fillStyle = 'rgba(255, 60, 90, 0.55)'
          for (let i = 0; i < 8; i += 2) { ctx.fillRect(i * 8, 0, 8, size); ctx.fillRect(0, i * 8, size, 8) }
          texture = new THREE.CanvasTexture(canvas)
          texture.colorSpace = THREE.SRGBColorSpace
          texture.wrapS = THREE.RepeatWrapping
          texture.wrapT = THREE.RepeatWrapping
          texture.repeat.set(3, 1.5)
        }
      }
      const blanket = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 0.9, 1, 1), new THREE.MeshPhysicalMaterial({ ...(texture !== null ? { map: texture } : { color: '#ffd1dc' }), roughness: 0.9, sheen: 0.6, sheenColor: new THREE.Color('#ffffff') }))
      blanket.rotation.x = -Math.PI / 2 + 0.75
      blanket.position.set(0, -0.5, -0.1)
      g.add(blanket)
      const wicker = mat('#c98a3c', { roughness: 0.85 })
      const basket = box(0.42, 0.26, 0.28, wicker, 0.05)
      basket.position.set(0.85, -0.4, -0.1)
      const handle = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.02, 12, 32, Math.PI), wicker)
      handle.position.set(0.85, -0.27, -0.1)
      const cloth = box(0.4, 0.04, 0.26, mat('#ff4f81', { roughness: 0.8 }), 0.02)
      cloth.position.set(0.85, -0.26, -0.1)
      const apple = ball(0.06, mat('#ff3b3b', { clearcoat: 1, roughness: 0.25 }))
      apple.position.set(-0.85, -0.5, 0.2)
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.1, 20), mat('#2ec5ff', { clearcoat: 1 }))
      cup.position.set(-0.65, -0.5, 0.25)
      g.add(basket, handle, cloth, apple, cup)
      break
    }
    case 'ball': {
      // A fuzzy tennis ball: felt, like the pets.
      g.add(feltBlob((x, y, z) => Math.hypot(x, y, z) - 0.12, 0.2, '#d8f24a', '#ffffff'))
      break
    }
  }
  return g
}
