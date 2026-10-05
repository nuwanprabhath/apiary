/**
 * How the 3D renders are framed, in scene units — kept apart from `props.ts` so the page can place
 * scenery without loading three.js (which only the render worker needs).
 */
export type SceneryProp = 'pond' | 'tree' | 'picnic' | 'ball'

/** A pet's render shows this many scene units, top to bottom (camera at 6.4, 18° field of view). */
export const PET_FRAME_UNITS = 2 * 6.4 * Math.tan((9 * Math.PI) / 180)

/** Each scenery render's shape: width over height, half its height in scene units, and its middle. */
export const SCENERY_FRAME: Record<SceneryProp, { aspect: number; halfHeight: number; centreY: number }> = {
  pond: { aspect: 2.4, halfHeight: 0.5, centreY: -0.15 },
  tree: { aspect: 0.8, halfHeight: 1.6, centreY: 0.95 },
  picnic: { aspect: 2.4, halfHeight: 0.5, centreY: -0.12 },
  ball: { aspect: 1, halfHeight: 0.19, centreY: 0 },
}

/** A pet is drawn from the front, or turned to face right for what reads best in profile. */
export type PetView = 'front' | 'side'

/** Things pets hold, use and ride (props.ts builds them). */
export const HELD_PROPS = ['laptop', 'dumbbells', 'donut', 'juice', 'ropeUp', 'ropeDown', 'racket', 'rod', 'fish', 'car', 'parachute', 'book', 'skateboard', 'easel', 'brush'] as const
export type HeldProp = typeof HELD_PROPS[number]

/**
 * Which way each prop is rendered: with a pet in profile (built facing +z, as the pet does, and
 * turned with it) or from the front.
 */
export const PROP_VIEW: Record<HeldProp, PetView> = {
  laptop: 'side', donut: 'side', juice: 'side', rod: 'side', car: 'side', skateboard: 'side', easel: 'side', brush: 'side',
  dumbbells: 'front', ropeUp: 'front', ropeDown: 'front', racket: 'front', fish: 'front', parachute: 'front', book: 'front',
}

/**
 * How far a profile is turned: not quite side-on, so the near eye stays on the face (a pure
 * profile of a round plush is just a ball with a bump).
 */
export const SIDE_TURN = (58 * Math.PI) / 180
