import { describe, it, expect, afterEach, onTestFinished } from 'vitest'
import { page } from 'vitest/browser'
import { nextFrames } from './helpers'
import { createRoot, type Root } from 'react-dom/client'
import { flushSync } from 'react-dom'
import '../../src/renderer/styles.css'
import { PetSprite, viewOf } from '../../src/renderer/features/pets/PetSprite'
import { setTestSeams } from '../../src/renderer/state/testSeams'
import { STARTER_PET } from '@shared/pets/builtins'
import { ACCESSORY_SLOTS, BODY_SHAPES, EYE_STYLES, type PetSpec } from '@shared/pets/spec'
import { validatePet } from '@shared/pets/validate'
import type { Activity, Face } from '@shared/pets/brain'

/**
 * Pets drawn on their own, every part and pose, in real Chromium with the app's stylesheet. The
 * screenshots (test-results/pets/) are for looking at after changing a part — a pet has to look
 * right, and no assertion says whether it is cute.
 */
let root: Root | null = null
let host: HTMLElement | null = null
afterEach(() => { root?.unmount(); host?.remove(); root = null; host = null })

function draw(node: React.ReactNode): HTMLElement {
  host = document.createElement('div')
  host.style.cssText = 'display:flex;flex-wrap:wrap;gap:18px;padding:24px;background:#1b2030;width:900px'
  document.body.append(host)
  root = createRoot(host)
  flushSync(() => { root!.render(node) })
  return host
}

const COLORS = ['#2f7bff', '#5bd65b', '#ffc93c', '#ff3fae', '#9b5cff', '#ff7a2f', '#20d3c2', '#ff4d4d']
const variety: PetSpec[] = BODY_SHAPES.map((shape, i) => validatePet({
  ...STARTER_PET,
  body: { shape, color: COLORS[i], accent: '#ffffff', texture: (['fuzzy', 'glossy', 'matte'] as const)[i % 3] },
  eyes: { style: EYE_STYLES[i % EYE_STYLES.length], color: '#14141f' },
  arms: (['nub', 'noodle', 'mitten'] as const)[i % 3],
  legs: (['stubby', 'feet', 'boots'] as const)[i % 3],
  accessories: [
    { kind: ACCESSORY_SLOTS.head[i % ACCESSORY_SLOTS.head.length], color: '#1b1b24' },
    ...(i % 2 === 0 ? [{ kind: ACCESSORY_SLOTS.face[i % ACCESSORY_SLOTS.face.length], color: '#111111' }] : []),
    ...(i % 3 === 0 ? [{ kind: ACCESSORY_SLOTS.neck[i % 2], color: '#ff5470' }] : []),
  ],
})!)

describe('a pet sprite', () => {
  it('draws every body, eye, limb and accessory in the pet\'s own colours, with no text from the pet in it', async () => {
    const el = draw(variety.map((spec) => (
      <div key={spec.body.shape} data-testid={`pet-${spec.body.shape}`}>
        <PetSprite spec={{ ...spec, name: '<b>evil</b>' }} size={96} activity="idle" face="happy" facing="right" />
      </div>
    )))
    for (const spec of variety) {
      const pet = el.querySelector(`[data-testid="pet-${spec.body.shape}"] .pet-sprite`)!
      expect(pet.getAttribute('data-shape')).toBe(spec.body.shape)
      expect(pet.querySelector('.pet-body stop[offset="0.45"]')?.getAttribute('stop-color')).toBe(spec.body.color)
      expect(pet.getBoundingClientRect().width).toBe(96)
    }
    expect(el.textContent).toBe('')
    expect(el.querySelector('b')).toBeNull()
    await page.screenshot({ element: el, path: '../../test-results/pets/gallery.png' })
  })

  it('shows its mood and what it is doing, and turns to face where it is going', async () => {
    const poses: [Activity, Face][] = [['idle', 'happy'], ['walk', 'happy'], ['sleep', 'sleepy'], ['read', 'focused'], ['celebrate', 'happy'], ['nervous', 'worried'], ['watch', 'focused'], ['wave', 'love'], ['held', 'surprised']]
    const el = draw(poses.map(([activity, face]) => (
      <div key={activity} data-testid={`pose-${activity}`}>
        <PetSprite spec={STARTER_PET} size={96} activity={activity} face={face} facing={activity === 'walk' ? 'left' : 'right'} />
      </div>
    )))
    const sprite = (a: string): Element => el.querySelector(`[data-testid="pose-${a}"] .pet-sprite`)!
    expect(sprite('sleep').querySelector('.pet-zzz')).not.toBeNull()
    expect(sprite('read').querySelector('.pet-prop svg')).not.toBeNull()
    expect(sprite('idle').querySelector('.pet-zzz')).toBeNull()
    expect(getComputedStyle(sprite('walk').querySelector('.pet-flip')!).transform).toBe('matrix(-1, 0, 0, 1, 0, 0)')
    expect(getComputedStyle(sprite('walk').querySelector('.pet-leg-l')!).animationName).toBe('pet-step')
    expect(getComputedStyle(sprite('sleep').querySelector('.pet-leg-l')!).opacity).toBe('0')
    await page.screenshot({ element: el, path: '../../test-results/pets/poses.png' })
  })

  it('turns side-on for what reads best in profile, and faces the window going up the rail', () => {
    for (const a of ['computer', 'drink', 'eat', 'fish', 'paint'] as const) {
      expect(viewOf(a, false)).toBe('side')
      expect(viewOf(a, true)).toBe('side')
    }
    for (const a of ['walk', 'run', 'carry', 'drive', 'skate'] as const) {
      expect(viewOf(a, false)).toBe('side')
      expect(viewOf(a, true)).toBe('front')
    }
    for (const a of ['idle', 'read', 'sleep', 'point', 'exercise', 'climb'] as const) expect(viewOf(a, false)).toBe('front')
  })

  it('animates only transforms and opacity, on HTML layers, never inside an SVG', () => {
    const el = draw(<PetSprite spec={STARTER_PET} size={48} activity="walk" face="happy" facing="right" />)
    const animated = [...el.querySelectorAll('*')].filter((n) => getComputedStyle(n).animationName !== 'none')
    expect(animated.length).toBeGreaterThan(0)
    for (const n of animated) expect(n.closest('svg')).toBeNull()
  })

  // Opt-in, like petRender3d: software WebGL starves the suite (e2e checks the 3D swap on a GPU).
  it.skipIf((import.meta as unknown as { env: Record<string, string | undefined> }).env.VITE_PET_GALLERY !== '1')('swaps in its 3D render once the worker has made it, and changes expression without re-rendering', { timeout: 120_000 }, async () => {
    setTestSeams({ petsFlat: false })
    onTestFinished(() => { setTestSeams({ petsFlat: true }) })
    const el = draw(<PetSprite spec={STARTER_PET} size={128} activity="idle" face="happy" facing="right" />)
    await expect.poll(() => el.querySelector('.pet-sprite')?.getAttribute('data-render'), { timeout: 110_000 }).toBe('3d')
    const face = (): string | null => el.querySelector('.pet-eyes img')?.getAttribute('src') ?? null
    const happy = face()
    flushSync(() => { root!.render(<PetSprite spec={STARTER_PET} size={128} activity="sleep" face="sleepy" facing="right" />) })
    expect(el.querySelector('.pet-sprite')?.getAttribute('data-render')).toBe('3d')
    expect(face()).not.toBe(happy)
    await page.screenshot({ element: el, path: '../../test-results/pets/sprite3d.png' })
  })

  // Opt-in with the gallery: every pose in 3D, props and profiles included, to look at.
  it.skipIf((import.meta as unknown as { env: Record<string, string | undefined> }).env.VITE_PET_GALLERY !== '1')('poses in 3D, side-on where that reads best', { timeout: 240_000 }, async () => {
    setTestSeams({ petsFlat: false })
    onTestFinished(() => { setTestSeams({ petsFlat: true }) })
    const poses: [Activity, Face][] = [
      ['idle', 'happy'], ['walk', 'happy'], ['run', 'love'], ['computer', 'focused'], ['drink', 'happy'], ['eat', 'love'],
      ['carry', 'happy'], ['fish', 'focused'], ['drive', 'happy'], ['skate', 'love'], ['paint', 'focused'], ['read', 'focused'],
      ['exercise', 'focused'], ['tennis', 'happy'], ['sleep', 'sleepy'], ['fishcaught', 'love'],
    ]
    const specs = [STARTER_PET, variety[1], variety[7]]
    const el = draw(specs.flatMap((spec, i) => poses.map(([activity, face]) => (
      <div key={`${String(i)}-${activity}`} data-testid={`pose3d-${String(i)}-${activity}`} style={{ outline: '1px dashed #333' }}>
        <PetSprite spec={spec} size={128} activity={activity} face={face} facing={i === 2 ? 'left' : 'right'} />
      </div>
    ))))
    el.style.width = '1300px'
    await expect.poll(() => el.querySelectorAll('.pet-sprite[data-render="3d"]').length, { timeout: 220_000 }).toBe(specs.length * poses.length)
    await expect.poll(() => el.querySelectorAll('.pet-held').length, { timeout: 60_000 }).toBeGreaterThan(10)
    expect(el.querySelector('[data-testid="pose3d-0-computer"] .pet-sprite')?.getAttribute('data-view')).toBe('side')
    expect(el.querySelector('[data-testid="pose3d-0-read"] .pet-sprite')?.getAttribute('data-view')).toBe('front')
    // Still, so the sheet shows each pose's resting frame.
    const still = document.createElement('style')
    still.textContent = '.pet-sprite, .pet-sprite * { animation-play-state: paused !important; animation-delay: -0.2s !important; }'
    document.head.append(still)
    onTestFinished(() => { still.remove() })
    await nextFrames(2)
    await page.screenshot({ element: el, path: '../../test-results/pets/poses3d.png' })
  })
})
