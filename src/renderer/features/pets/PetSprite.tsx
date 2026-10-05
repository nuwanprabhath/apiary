import { type CSSProperties, type JSX, memo, useId } from 'react'
import type { PetSpec } from '@shared/pets/spec'
import type { Activity, Face } from '@shared/pets/brain'
import { Accessories, Arm, Body, Eyes, Leg, Mouth, Props, Shadow, Zzz, mouthFor, shoulderOrigin } from './parts'
import { usePetImages, useProps } from './render3d/usePetImages'
import type { PetImages } from './render3d/render'
import { PROP_VIEW, type HeldProp, type PetView } from './render3d/frames'
import type { FaceKey } from './render3d/parts3d'

interface Props {
  spec: PetSpec
  size: number
  activity: Activity
  face: Face
  facing: 'left' | 'right'
  /** Up the rail, where a pet moves up and down: walking in profile would read as sliding. */
  onRail?: boolean
}

/**
 * One pet. It is drawn in 3D (`render3d/`): rendered once, in a worker, into an image per part
 * and per expression, which this stacks. Until those are ready — or where WebGL is not available —
 * it draws the flat version from `parts.tsx` in the same layers.
 *
 * Each moving part is an HTML layer of its own. That is for speed, measured: Chromium composites a
 * CSS transform animation on an HTML element on the GPU, but one on an element *inside* an SVG
 * repaints the SVG on the main thread every frame. So breathing, blinking and walking (70-pets.css,
 * keyed off `data-activity` and `data-face`) cost the page nothing while they run.
 */
export const PetSprite = memo(function PetSprite(props: Props): JSX.Element {
  const look = usePetImages(props.spec)
  if (look.state === 'ready') return <Rendered {...props} images={look.images} />
  // While the render is on its way the pet is laid out but not shown, so it never appears flat
  // and then turns 3D in front of you; the flat one stays only where 3D cannot be had.
  return <Drawn {...props} pending={look.state === 'pending'} />
})

function faceKey(face: Face, activity: Activity): FaceKey {
  return mouthFor(face, activity) === 'open' ? 'open' : face
}

/** Things done side-on: they read best in profile (a laptop's lid, a straw, a stride). */
const SIDE_ALWAYS: ReadonlySet<Activity> = new Set(['computer', 'eat', 'drink', 'fish', 'paint'])
/** Ways of getting along the status bar, side-on there; up the rail a pet faces the window. */
const SIDE_ON_BAR: ReadonlySet<Activity> = new Set(['walk', 'run', 'carry', 'drive', 'skate'])

export function viewOf(activity: Activity, onRail: boolean): PetView {
  return SIDE_ALWAYS.has(activity) || (!onRail && SIDE_ON_BAR.has(activity)) ? 'side' : 'front'
}

/**
 * What a pet holds while doing something: in front of it, in the hand nearest us, or on the
 * ground with it (a car, a board, an easel: not moved by its bobbing).
 */
const HELD: Partial<Record<Activity, { prop: HeldProp; at: 'front' | 'hand' | 'ground' }[]>> = {
  computer: [{ prop: 'laptop', at: 'front' }],
  exercise: [{ prop: 'dumbbells', at: 'front' }],
  eat: [{ prop: 'donut', at: 'front' }],
  carry: [{ prop: 'donut', at: 'front' }],
  drink: [{ prop: 'juice', at: 'front' }],
  read: [{ prop: 'book', at: 'front' }],
  fishcaught: [{ prop: 'fish', at: 'front' }],
  parachute: [{ prop: 'parachute', at: 'front' }],
  tennis: [{ prop: 'racket', at: 'hand' }],
  fish: [{ prop: 'rod', at: 'front' }],
  drive: [{ prop: 'car', at: 'ground' }],
  skate: [{ prop: 'skateboard', at: 'ground' }],
  paint: [{ prop: 'easel', at: 'ground' }, { prop: 'brush', at: 'front' }],
}

function Rendered({ size, activity, face, facing, spec, images, onRail = false }: Props & { images: PetImages }): JSX.Element {
  const props = useProps()
  const view = viewOf(activity, onRail)
  const v = images[view]
  // Only props drawn for this view: a profile's laptop would float beside a pet facing us.
  const held = props !== null ? (HELD[activity] ?? []).filter((h) => PROP_VIEW[h.prop] === view) : []
  const propsAt = (at: 'front' | 'hand' | 'ground'): JSX.Element[] => props === null ? [] : held.filter((h) => h.at === at).map((h) => (
    <div key={h.prop} className="pet-part pet-held" data-prop={h.prop}><img src={props.held[h.prop]} alt="" draggable={false} /></div>
  ))
  const rope = (kind: HeldProp, cls: string): JSX.Element | null => props === null ? null : (
    <div className={`pet-part pet-held ${cls}`} data-prop={kind}><img src={props.held[kind]} alt="" draggable={false} /></div>
  )
  // The renders leave room under the feet; this puts the feet on the bottom edge, where the drawn
  // version has them.
  const style = { '--pet-size': `${String(size)}px`, '--pet-floor': String(1 - v.floor) } as CSSProperties
  const img = (src: string): JSX.Element => <img src={src} alt="" draggable={false} />
  // From the front the left arm is behind the body's edge and the right in front of it (as drawn);
  // in profile the near arm and leg (`L`) go in front of the far ones.
  const armL = <div key="armL" className="pet-part pet-arm pet-arm-l" style={{ transformOrigin: v.pivots.armL }}>{img(v.armL)}{view === 'side' && propsAt('hand')}</div>
  const armR = <div key="armR" className="pet-part pet-arm pet-arm-r" style={{ transformOrigin: v.pivots.armR }}>{img(v.armR)}{view === 'front' && propsAt('hand')}</div>
  const legL = <div key="legL" className="pet-part pet-leg pet-leg-l" style={{ transformOrigin: v.pivots.legL }}>{img(v.legL)}</div>
  const legR = <div key="legR" className="pet-part pet-leg pet-leg-r" style={{ transformOrigin: v.pivots.legR }}>{img(v.legR)}</div>
  const [backArm, frontArm] = view === 'side' ? [armR, armL] : [armL, armR]
  return (
    <div className="pet-sprite" style={style} data-activity={activity} data-face={face} data-facing={facing} data-shape={spec.body.shape} data-render="3d" data-view={view}>
      <div className="pet-flip pet-grounded">
        <div className="pet-part pet-shadow"><Shadow /></div>
        {view === 'side' ? <>{legR}{legL}</> : <>{legL}{legR}</>}
        <div className="pet-part pet-bob">
          {backArm}
          <div className="pet-part pet-breathe">
            <div className="pet-part pet-body">{img(v.body)}</div>
            <div className="pet-part pet-eyes" style={{ transformOrigin: v.pivots.eyes }}>{img(v.faces[faceKey(face, activity)])}</div>
            {v.accessories !== null && <div className="pet-part pet-acc">{img(v.accessories)}</div>}
          </div>
          {frontArm}
          {propsAt('front')}
          {activity === 'skip' && <>{rope('ropeUp', 'pet-rope-up')}{rope('ropeDown', 'pet-rope-down')}</>}
          {/* The drawn book stands in only where there is no 3D one. */}
          {!(props !== null && activity === 'read') && <div className="pet-part pet-prop"><Props spec={spec} activity={activity} /></div>}
        </div>
        {propsAt('ground')}
        {activity === 'sleep' && <div className="pet-part pet-zzz"><Zzz /></div>}
      </div>
    </div>
  )
}

function Drawn({ spec, size, activity, face, facing, pending }: Props & { pending: boolean }): JSX.Element {
  const reactId = useId()
  // SVG ids end up in `url(#…)`, where React's colons would not parse.
  const uid = `pet${reactId.replace(/[^a-zA-Z0-9]/g, '')}`
  const style = { '--pet-size': `${String(size)}px` } as CSSProperties
  return (
    <div className="pet-sprite" style={style} data-activity={activity} data-face={face} data-facing={facing} data-shape={spec.body.shape} data-render={pending ? 'pending' : 'drawn'}>
      <div className="pet-flip">
        <div className="pet-part pet-shadow"><Shadow /></div>
        <div className="pet-part pet-leg pet-leg-l"><Leg spec={spec} side="l" /></div>
        <div className="pet-part pet-leg pet-leg-r"><Leg spec={spec} side="r" /></div>
        <div className="pet-part pet-bob">
          <div className="pet-part pet-arm pet-arm-l" style={{ transformOrigin: shoulderOrigin(spec, 'l') }}><Arm spec={spec} side="l" /></div>
          <div className="pet-part pet-breathe">
            <div className="pet-part pet-body"><Body spec={spec} uid={uid} /></div>
            <div className="pet-part pet-face"><Mouth spec={spec} mouth={mouthFor(face, activity)} /></div>
            <div className="pet-part pet-eyes"><Eyes spec={spec} face={face} /></div>
            <div className="pet-part pet-acc"><Accessories spec={spec} /></div>
          </div>
          <div className="pet-part pet-arm pet-arm-r" style={{ transformOrigin: shoulderOrigin(spec, 'r') }}><Arm spec={spec} side="r" /></div>
          <div className="pet-part pet-prop"><Props spec={spec} activity={activity} /></div>
        </div>
        {activity === 'sleep' && <div className="pet-part pet-zzz"><Zzz /></div>}
      </div>
    </div>
  )
}
