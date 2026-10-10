/**
 * What a pet is: data, never code (see CLAUDE.md in this folder). Apiary draws every pet from its
 * own library of parts (`renderer/features/pets/parts.tsx`); a pet only says which parts, in which
 * colours, and how it behaves. `validatePet` is the only way anything becomes a `PetSpec`.
 */

export const BODY_SHAPES = ['blob', 'bean', 'drop', 'heart', 'star', 'ghost', 'puff', 'cube'] as const
export const TEXTURES = ['fuzzy', 'glossy', 'matte'] as const
export const EYE_STYLES = ['round', 'button', 'sparkle', 'sleepy', 'wide'] as const
export const ARMS = ['nub', 'noodle', 'mitten'] as const
export const LEGS = ['stubby', 'feet', 'boots'] as const

/** Each accessory belongs to a slot, and a pet wears at most one per slot. */
export const ACCESSORY_SLOTS = {
  head: ['beret', 'cap', 'beanie', 'crown', 'flower', 'headphones'],
  face: ['round-glasses', 'sunglasses', 'monocle'],
  neck: ['bowtie', 'scarf'],
} as const
export type AccessorySlot = keyof typeof ACCESSORY_SLOTS
export const ACCESSORIES = [
  ...ACCESSORY_SLOTS.head, ...ACCESSORY_SLOTS.face, ...ACCESSORY_SLOTS.neck,
] as const

/** When a line is said: the pet's own mood, or what Claude is doing. */
export const SITUATIONS = ['idle', 'working', 'finished', 'waiting', 'sleepy', 'greet', 'petted', 'conversation', 'wrappedUp'] as const

export type BodyShape = typeof BODY_SHAPES[number]
export type Texture = typeof TEXTURES[number]
export type EyeStyle = typeof EYE_STYLES[number]
export type Arms = typeof ARMS[number]
export type Legs = typeof LEGS[number]
export type Accessory = typeof ACCESSORIES[number]
export type Situation = typeof SITUATIONS[number]

export const TRAITS = ['energy', 'curiosity', 'sleepiness', 'sociability'] as const
export type Trait = typeof TRAITS[number]

export interface PetSpec {
  version: 1
  name: string
  /** One line of character: "a sleepy librarian who hums while Claude works". */
  tagline: string
  body: { shape: BodyShape; color: string; accent: string; texture: Texture }
  eyes: { style: EyeStyle; color: string }
  cheeks: boolean
  arms: Arms
  legs: Legs
  accessories: { kind: Accessory; color: string }[]
  /** 0..1 each: how the pet chooses what to do (`brain.ts`). */
  traits: Record<Trait, number>
  lines: Partial<Record<Situation, string[]>>
}

export const LIMITS = {
  name: 24,
  tagline: 120,
  line: 80,
  linesPerSituation: 12,
  accessories: 3,
} as const

export function slotOf(kind: Accessory): AccessorySlot {
  if ((ACCESSORY_SLOTS.head as readonly string[]).includes(kind)) return 'head'
  if ((ACCESSORY_SLOTS.face as readonly string[]).includes(kind)) return 'face'
  return 'neck'
}
