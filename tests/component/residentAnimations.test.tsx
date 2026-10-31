import { describe, it, expect } from 'vitest'
import type { ResidentAnimation, ResidentGlyph, ResidentStatus } from '@shared/domain/residents'
import { kindInfos } from '../../src/main/residents/kinds'
import type { MotionSetting } from '@shared/settings/schema'
import { renderApp } from './renderApp'
import { until } from './helpers'
import { mrDeskStatus, regentStatus, withMrDesk, withRegent } from './residentFixtures'

/**
 * The badge's motion, read from the animations Chromium is running (pseudo-elements included),
 * for every kind's appearance in every state. The rows come from `kindInfos()`, and the per-glyph
 * and per-animation tables are `Record`s, so a new kind, glyph or animation without its row here
 * fails to compile or fails a case.
 */

type Moving = 'idle' | 'working'

/** Shared by every kind: the halo spins (slowly when idle) and the glow breathes when idle. */
const SHARED: Record<Moving, string[]> = { idle: ['resident-halo-spin', 'resident-breathe'], working: ['resident-halo-spin'] }
/**
 * What the glyph itself adds: at rest the bee flaps now and then, twitches each antenna and bobs,
 * each on a cycle of its own length; working, the wings flutter.
 */
const BY_GLYPH: Record<ResidentGlyph, Record<Moving, string[]>> = {
  bee: { idle: ['resident-bee-flap', 'resident-antenna-front', 'resident-antenna-back', 'resident-bee-bob'], working: ['resident-flutter'] },
  honeypot: { idle: [], working: [] },
}
/** What the kind's animation adds: the stir sways the dipper when idle and stirs it while working. */
const BY_ANIMATION: Record<ResidentAnimation, Record<Moving, string[]>> = {
  halo: { idle: [], working: [] },
  stir: { idle: ['resident-sway', 'resident-streak-drift', 'resident-pot-bubble'], working: ['resident-stir', 'resident-streak-swirl'] },
}
const NEEDS = ['resident-needs-pulse', 'resident-hop']

const KINDS = kindInfos().map((k) => ({ id: k.id, appearance: k.appearance }))

function statusFor(kind: string, state: ResidentStatus['state'], extra: Partial<ResidentStatus> = {}): ResidentStatus {
  const base = kind === 'regent' ? regentStatus(state) : mrDeskStatus(state)
  return { ...base, ...extra }
}

const badge = (id: string): HTMLElement | null => document.querySelector(`[data-testid="resident-badge-${id}"]`)
const orb = (id: string): HTMLElement => badge(id)!.querySelector<HTMLElement>('.resident-orb')!
const pill = (id: string): string => badge(id)!.querySelector('.resident-activity')!.textContent ?? ''
const running = (id: string): CSSAnimation[] =>
  badge(id)!.getAnimations({ subtree: true }).filter((a): a is CSSAnimation => a instanceof CSSAnimation && a.playState === 'running')
const names = (id: string): string[] => [...new Set(running(id).map((a) => a.animationName))].sort()
const infinite = (id: string): CSSAnimation[] => running(id).filter((a) => a.effect?.getComputedTiming().iterations === Infinity)
const durationOf = (id: string, name: string): number => {
  const found = running(id).find((a) => a.animationName === name)
  const d = found?.effect?.getComputedTiming().duration
  return typeof d === 'number' ? d : NaN
}

async function mount(kind: string, motion: MotionSetting = 'full'): Promise<Awaited<ReturnType<typeof renderApp>>['fake']> {
  const { fake } = await renderApp({ settings: { motion } }, (f) => { if (kind === 'regent') withRegent(f); else withMrDesk(f) })
  await until(() => badge(kind) !== null)
  return fake
}

const expected = (kind: (typeof KINDS)[number], state: Moving): string[] =>
  [...SHARED[state], ...BY_GLYPH[kind.appearance.glyph][state], ...BY_ANIMATION[kind.appearance.animation][state]].sort()

describe.each(KINDS)('the $id badge ($appearance.glyph, $appearance.animation)', (kind) => {
  it('asleep: nothing moves, it is faded and shows the z', async () => {
    const fake = await mount(kind.id)
    fake.emit('residentsChanged', [statusFor(kind.id, 'asleep')])
    await until(() => badge(kind.id)?.dataset.state === 'asleep')
    await expect.poll(() => names(kind.id)).toEqual([])
    expect(Number(getComputedStyle(orb(kind.id)).opacity)).toBeLessThan(1)
    expect(orb(kind.id).querySelector('.resident-z')?.textContent).toBe('z')
    expect(pill(kind.id)).toBe('')
  })

  it('idle: the slow halo and the breathing, and the glyph moves only as idle says', async () => {
    const fake = await mount(kind.id)
    fake.emit('residentsChanged', [statusFor(kind.id, 'idle')])
    await until(() => badge(kind.id)?.dataset.state === 'idle')
    await expect.poll(() => names(kind.id)).toEqual(expected(kind, 'idle'))
    expect(orb(kind.id).querySelector('.resident-z')).toBeNull()
  })

  it('idle: the glyph\'s and the animation\'s own motions each run on a cycle of a different length', async () => {
    const fake = await mount(kind.id)
    fake.emit('residentsChanged', [statusFor(kind.id, 'idle')])
    await expect.poll(() => names(kind.id)).toEqual(expected(kind, 'idle'))
    // The streak drifts with the dipper's sway, so the two share a cycle.
    const own = [...BY_GLYPH[kind.appearance.glyph].idle, ...BY_ANIMATION[kind.appearance.animation].idle]
      .filter((n) => n !== 'resident-streak-drift')
    const durations = own.map((n) => durationOf(kind.id, n))
    expect(durations.every((d) => d > 0)).toBe(true)
    expect(new Set(durations).size).toBe(own.length)
  })

  it('working: the fast halo plus the glyph\'s working motion, and the pill says the words', async () => {
    const fake = await mount(kind.id)
    fake.emit('residentsChanged', [statusFor(kind.id, 'idle')])
    await expect.poll(() => names(kind.id)).toEqual(expected(kind, 'idle'))
    const idleSpin = durationOf(kind.id, 'resident-halo-spin')
    fake.emit('residentsChanged', [statusFor(kind.id, 'working', { activity: 'Running mra prompt 1559' })])
    await expect.poll(() => names(kind.id)).toEqual(expected(kind, 'working'))
    expect(pill(kind.id)).toBe('Running mra prompt 1559')
    const workingSpin = durationOf(kind.id, 'resident-halo-spin')
    expect(workingSpin).toBeGreaterThan(0)
    expect(workingSpin).toBeLessThan(idleSpin)
  })

  it.each([
    { from: 'attention', extra: { attention: { count: 2, summary: '2 MRs ready to approve' } }, count: '2', words: '2 MRs ready to approve' },
    { from: 'a permission', extra: { permissions: [{ requestId: 'r1', tool: 'Bash', summary: 'Run: glab mr view 1047' }] }, count: '1', words: 'Waiting for your OK' },
  ])('needs you from $from: the ring pulses, the orb hops, the count and the pill show', async ({ extra, count, words }) => {
    const fake = await mount(kind.id)
    fake.emit('residentsChanged', [statusFor(kind.id, 'idle', extra as Partial<ResidentStatus>)])
    await until(() => badge(kind.id)?.dataset.needs === 'true')
    await expect.poll(() => names(kind.id)).toEqual([...expected(kind, 'idle'), ...NEEDS].sort())
    expect(badge(kind.id)!.querySelector('[data-testid="resident-count"]')!.textContent).toBe(count)
    expect(pill(kind.id)).toBe(words)
    fake.emit('residentsChanged', [statusFor(kind.id, 'working', { ...(extra as Partial<ResidentStatus>), activity: 'Writing' })])
    await expect.poll(() => names(kind.id)).toEqual([...expected(kind, 'working'), ...NEEDS].sort())
    expect(pill(kind.id)).toBe('Writing')
  })

  it.each([
    { name: 'asleep', state: 'asleep', extra: {}, words: '', count: null, ring: 'none' },
    { name: 'idle', state: 'idle', extra: {}, words: '', count: null, ring: 'none' },
    { name: 'working', state: 'working', extra: { activity: 'Running mra prompt 1559' }, words: 'Running mra prompt 1559', count: null, ring: 'none' },
    { name: 'needs you', state: 'idle', extra: { attention: { count: 2, summary: '2 MRs ready to approve' } }, words: '2 MRs ready to approve', count: '2', ring: 'solid' },
  ] as const)('reduced motion, $name: nothing runs forever, the still cues stay', async ({ state, extra, words, count, ring }) => {
    const fake = await mount(kind.id, 'reduced')
    await until(() => document.documentElement.dataset.motion === 'reduced')
    fake.emit('residentsChanged', [statusFor(kind.id, state, extra)])
    await until(() => badge(kind.id)?.dataset.state === state && pill(kind.id) === words)
    await expect.poll(() => infinite(kind.id).map((a) => a.animationName)).toEqual([])
    expect(badge(kind.id)!.querySelector('[data-testid="resident-count"]')?.textContent ?? null).toBe(count)
    expect(getComputedStyle(badge(kind.id)!.querySelector('.resident-badge-orb')!, '::after').borderTopStyle).toBe(ring)
    for (const part of orb(kind.id).querySelectorAll('.bee-wing-l, .bee-wing-r, .bee-antenna-front, .bee-antenna-back')) {
      expect(getComputedStyle(part).transform).toBe('none')
    }
  })
})

/** The orb is drawn larger in a taller bar (statusBarSize.test.tsx); what moves must not change with it. */
describe.each([22, 34, 52])('at a %i px status bar', (px) => {
  it.each(KINDS)('the $id badge runs the same animations idle, working and needing you', async (kind) => {
    localStorage.setItem('apiary.statusBarHeight', String(px))
    const fake = await mount(kind.id)
    await until(() => document.querySelector<HTMLElement>('[data-testid="status-bar"]')?.style.getPropertyValue('--status-bar-height') === `${String(px)}px`)
    fake.emit('residentsChanged', [statusFor(kind.id, 'idle')])
    await expect.poll(() => names(kind.id)).toEqual(expected(kind, 'idle'))
    fake.emit('residentsChanged', [statusFor(kind.id, 'working', { activity: 'Running mra prompt 1559', attention: { count: 2, summary: '2 MRs' } })])
    await expect.poll(() => names(kind.id)).toEqual([...expected(kind, 'working'), ...NEEDS].sort())
    expect(pill(kind.id)).toBe('Running mra prompt 1559')
  })
})
