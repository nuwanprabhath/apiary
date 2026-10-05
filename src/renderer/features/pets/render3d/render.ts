import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import type { PetSpec } from '@shared/pets/spec'
import { FACES, anchorsOf, buildAccessories, buildArm, buildBody, buildFace, buildLeg, shoulderOf, type FaceKey } from './parts3d'
import { meshFromSdf } from './plush'
import { BODY_SDF } from './sdf'
import { HELD_PROPS, PROP_VIEW, SCENERY, SCENERY_FRAME, buildHeld, buildScenery, type HeldProp, type SceneryProp } from './props'
import { SIDE_TURN, type PetView } from './frames'

/** Every prop rendered: held ones in the pets' frame, scenery each in its own. */
export interface PropImages {
  held: Record<HeldProp, string>
  scenery: Record<SceneryProp, { src: string; aspect: number }>
}

/** A pet rendered from the front and in profile: everything it can look like. */
export interface PetImages {
  front: PetLayers
  /** Turned to face right (the page mirrors it to face left). `armL`/`legL` are the near ones. */
  side: PetLayers
}

/** One view of a pet: one transparent image per layer, all framed alike, plus where its joints are. */
export interface PetLayers {
  body: string
  faces: Record<FaceKey, string>
  accessories: string | null
  armL: string
  armR: string
  legL: string
  legR: string
  /** Joints and the eye line, as percentages of the image (CSS transform-origin). */
  pivots: { armL: string; armR: string; legL: string; legR: string; eyes: string }
  /** Where the feet touch the ground, as a fraction of the image's height from its top. */
  floor: number
}

/** The renders are square, this many pixels: twice the largest pet, for a sharp one on a Retina screen. */
export const RENDER_PX = 256

type Canvas = OffscreenCanvas | HTMLCanvasElement
const UP = new THREE.Vector3(0, 1, 0)

async function toDataUrl(canvas: Canvas): Promise<string> {
  const blob = 'convertToBlob' in canvas
    ? await canvas.convertToBlob({ type: 'image/png' })
    : await new Promise<Blob>((resolve, reject) => { canvas.toBlob((b) => { if (b !== null) resolve(b); else reject(new Error('No image.')) }, 'image/png') })
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return `data:image/png;base64,${btoa(bin)}`
}

/**
 * Renders pets with three.js, once per pet (and again only when what it looks like changes) —
 * never per frame. It runs in a worker on an OffscreenCanvas (`petRender.worker.ts`); the page
 * gets back images, and moves them with CSS exactly as it moved the drawn parts before.
 *
 * Every layer is rendered with the same camera, so they line up. A layer that sits on the body
 * (the face, an arm) is rendered with the body present but invisible — writing depth, not colour —
 * so whatever of it is behind the body is cut away, as it would be in the round.
 */
export class PetRenderer {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  /** What is being rendered stands on this, turned for a profile; the lights and camera stay put. */
  private readonly stage = new THREE.Group()
  private camera = new THREE.PerspectiveCamera(18, 1, 0.1, 50)

  constructor(private readonly canvas: Canvas) {
    canvas.width = RENDER_PX
    canvas.height = RENDER_PX
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true, premultipliedAlpha: false })
    this.renderer.setPixelRatio(1)
    this.renderer.setSize(RENDER_PX, RENDER_PX, false)
    this.renderer.toneMapping = THREE.NeutralToneMapping
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.setClearColor(0x000000, 0)
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    this.scene.environmentIntensity = 0.5
    pmrem.dispose()
    // A warm key from the upper left, a bright rim from behind — what makes felt glow at its edge —
    // and a cool fill so the shadow side keeps its colour.
    const key = new THREE.DirectionalLight(0xfff0dc, 2.6)
    key.position.set(-2.2, 3, 4)
    const rim = new THREE.DirectionalLight(0xffffff, 3.4)
    rim.position.set(2.5, 2, -3)
    const fill = new THREE.DirectionalLight(0xc8d8ff, 0.7)
    fill.position.set(3, -0.5, 2)
    // A small light by the camera puts the catch-light in glossy eyes.
    const glint = new THREE.PointLight(0xffffff, 6, 0, 2)
    glint.position.set(-0.8, 1.2, 3)
    this.scene.add(key, rim, fill, glint, new THREE.HemisphereLight(0xffffff, 0x2a2438, 0.45), this.stage)
    this.camera.position.set(0, 0.22, 6.4)
    this.camera.lookAt(0, 0.06, 0)
  }

  private pct(p: THREE.Vector3, turn: number): string {
    const v = p.clone().applyAxisAngle(UP, turn).project(this.camera)
    return `${((v.x + 1) * 50).toFixed(1)}% ${((1 - v.y) * 50).toFixed(1)}%`
  }

  private async shot(layer: THREE.Object3D, occluder: THREE.Object3D | null, turn = 0): Promise<string> {
    this.stage.rotation.y = turn
    this.stage.add(layer)
    if (occluder !== null) this.stage.add(occluder)
    this.renderer.render(this.scene, this.camera)
    this.stage.remove(layer)
    if (occluder !== null) this.stage.remove(occluder)
    return toDataUrl(this.canvas)
  }

  async render(spec: PetSpec): Promise<PetImages> {
    const a = anchorsOf(spec.body.shape)
    // The body as an invisible shape that hides what is behind it.
    const bodyGeometry = meshFromSdf(BODY_SDF[spec.body.shape])
    const occluder = new THREE.Mesh(bodyGeometry, new THREE.MeshBasicMaterial({ colorWrite: false }))
    occluder.renderOrder = -1
    const owned: THREE.Object3D[] = [occluder]
    const take = <T extends THREE.Object3D>(o: T): T => { owned.push(o); return o }
    const view = async (v: PetView): Promise<PetLayers> => {
      const turn = v === 'side' ? SIDE_TURN : 0
      const shot = (o: THREE.Object3D, hide = true): Promise<string> => this.shot(take(o), hide ? occluder : null, turn)
      const body = await shot(buildBody(spec, bodyGeometry), false)
      const faces = {} as Record<FaceKey, string>
      for (const f of FACES) faces[f] = await shot(buildFace(spec, a, f))
      const accessories = spec.accessories.length > 0 ? await shot(buildAccessories(spec, a)) : null
      const armL = await shot(buildArm(spec, a, 'l', v))
      const armR = await shot(buildArm(spec, a, 'r', v))
      const legL = await shot(buildLeg(spec, a, 'l'))
      const legR = await shot(buildLeg(spec, a, 'r'))
      const s = shoulderOf(a, v)
      return {
        body, faces, accessories, armL, armR, legL, legR,
        pivots: {
          armL: this.pct(new THREE.Vector3(-s.x, s.y, s.z), turn),
          armR: this.pct(s, turn),
          legL: this.pct(new THREE.Vector3(-0.2, a.bottom + 0.02, 0), turn),
          legR: this.pct(new THREE.Vector3(0.2, a.bottom + 0.02, 0), turn),
          eyes: this.pct(new THREE.Vector3(0, a.eyeY, a.front(0, a.eyeY)), turn),
        },
        floor: (1 - new THREE.Vector3(0, a.bottom - (spec.legs === 'stubby' ? 0.24 : 0.29), 0.05).applyAxisAngle(UP, turn).project(this.camera).y) / 2,
      }
    }
    try {
      return { front: await view('front'), side: await view('side') }
    } finally {
      for (const o of owned) {
        o.traverse((n) => {
          if (n instanceof THREE.Mesh) {
            (n.geometry as THREE.BufferGeometry).dispose()
            const m = n.material as THREE.Material | THREE.Material[]
            for (const mat of Array.isArray(m) ? m : [m]) mat.dispose()
          }
        })
      }
    }
  }

  async renderProps(): Promise<PropImages> {
    const held = {} as Record<HeldProp, string>
    const scenery = {} as Record<SceneryProp, { src: string; aspect: number }>
    const dispose = (o: THREE.Object3D): void => {
      o.traverse((n) => {
        if (n instanceof THREE.Mesh) {
          (n.geometry as THREE.BufferGeometry).dispose()
          for (const m of Array.isArray(n.material) ? n.material as THREE.Material[] : [n.material as THREE.Material]) m.dispose()
        }
      })
    }
    for (const kind of HELD_PROPS) {
      const o = buildHeld(kind)
      held[kind] = await this.shot(o, null, PROP_VIEW[kind] === 'side' ? SIDE_TURN : 0)
      dispose(o)
    }
    // Scenery gets a camera of its own shape, with its foot on the bottom edge.
    const pets = this.camera
    try {
      for (const kind of SCENERY) {
        const f = SCENERY_FRAME[kind]
        const h = RENDER_PX
        const w = Math.round(h * f.aspect)
        this.renderer.setSize(w, h, false)
        const cam = new THREE.PerspectiveCamera((2 * Math.atan(f.halfHeight / 6.4) * 180) / Math.PI, f.aspect, 0.1, 50)
        cam.position.set(0, f.centreY + 0.12, 6.4)
        cam.lookAt(0, f.centreY, 0)
        this.camera = cam
        const o = buildScenery(kind)
        scenery[kind] = { src: await this.shot(o, null), aspect: f.aspect }
        dispose(o)
      }
    } finally {
      this.camera = pets
      this.renderer.setSize(RENDER_PX, RENDER_PX, false)
    }
    return { held, scenery }
  }

  dispose(): void { this.renderer.dispose() }
}
