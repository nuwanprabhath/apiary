import { afterEach, describe, it, expect, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { emptyChatState } from '@shared/domain/chat'
import { asSessionId } from '@shared/domain/ids'
import type { MotionSetting } from '@shared/settings/schema'
import { BUSY_ANIMATION_IDS, BUSY_COLOR_IDS } from '@shared/domain/busyAnimation'
import { renderApp } from './renderApp'
import { sidebarSession, until } from './helpers'

const TITLE = 'Fix CSV export bug'
const motionOf = (): string | undefined => document.documentElement.dataset.motion

/** Makes the system ask (or not) for reduced motion, as the OS preference would. */
function systemPrefers(reduced: boolean): void {
  const real = window.matchMedia.bind(window)
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => {
    const list = real(query)
    return query.includes('prefers-reduced-motion')
      ? { matches: reduced, media: query, addEventListener: () => undefined, removeEventListener: () => undefined } as unknown as MediaQueryList
      : list
  })
}

type Mounted = Awaited<ReturnType<typeof renderApp>>

const mount = (motion: MotionSetting, gpu = true): Promise<Mounted> =>
  renderApp({ settings: { transcriptChat: true, motion } }, (f) => { f.override('themeGpuCompositing', async () => gpu) })

afterEach(() => { vi.restoreAllMocks() })

const infiniteAnimations = (): Animation[] =>
  document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations === Infinity)

async function busyChat(fake: Mounted['fake']): Promise<void> {
  await userEvent.click(sidebarSession(TITLE))
  await expect.element(page.getByTestId('chat-timeline')).toBeVisible()
  const sessionId = fake.state.sessions.find((s) => s.title === TITLE)!.sessionId
  const next = { ...emptyChatState(asSessionId(sessionId)), status: 'busy' as const, turnStartedAt: Date.now() }
  fake.state.chats.set(sessionId, next)
  fake.emit('chatChanged', { kind: 'full', state: next })
  await expect.element(page.getByTestId('chat-working')).toBeVisible()
}

describe('motion in effect', () => {
  it('Automatic is reduced when the GPU probe says no', async () => {
    systemPrefers(false)
    await mount('auto', false)
    await expect.poll(motionOf).toBe('reduced')
  })

  it('Automatic is full with a GPU and no system preference', async () => {
    systemPrefers(false)
    await mount('auto', true)
    await expect.poll(motionOf).toBe('full')
  })

  it('Automatic is reduced when the system asks for less motion', async () => {
    systemPrefers(true)
    await mount('auto', true)
    await expect.poll(motionOf).toBe('reduced')
  })

  it('Full overrides the system preference', async () => {
    systemPrefers(true)
    await mount('full', true)
    await expect.poll(motionOf).toBe('full')
  })

  it('Reduced overrides a working GPU', async () => {
    systemPrefers(false)
    await mount('reduced', true)
    await expect.poll(motionOf).toBe('reduced')
  })

  it('the Animations control changes it at once', async () => {
    systemPrefers(false)
    const { fake } = await mount('full', true)
    await expect.poll(motionOf).toBe('full')
    fake.emit('openSettingsDialog')
    await until(() => document.querySelector('[data-testid="settings-dialog"]') !== null)
    await userEvent.click(page.getByTestId('settings-nav-themes'))
    const select = page.getByTestId('setting-motion')
    await userEvent.selectOptions(select, 'reduced')
    await expect.poll(motionOf).toBe('reduced')
    await userEvent.selectOptions(select, 'full')
    await expect.poll(motionOf).toBe('full')
    await userEvent.selectOptions(select, 'auto')
    await expect.poll(motionOf).toBe('full')
  })

  it('survives the dialog being saved afterwards: its draft does not carry the old choice back', async () => {
    systemPrefers(false)
    const { fake } = await mount('full', true)
    fake.emit('openSettingsDialog')
    await until(() => document.querySelector('[data-testid="settings-dialog"]') !== null)
    await userEvent.click(page.getByTestId('settings-nav-themes'))
    await userEvent.selectOptions(page.getByTestId('setting-motion'), 'reduced')
    await expect.poll(motionOf).toBe('reduced')
    await userEvent.click(page.getByTestId('settings-nav-sidebar'))
    await userEvent.click(page.getByTestId('setting-hide-old-enabled'))
    await userEvent.click(page.getByTestId('settings-save'))
    await until(() => document.querySelector('[data-testid="settings-dialog"]') === null)
    expect((await window.apiary.settingsGet()).motion).toBe('reduced')
    await expect.poll(motionOf).toBe('reduced')
  })
})

describe('reduced motion has no infinite animation in the chrome', () => {
  it('Full mode runs some, so the check sees them', async () => {
    systemPrefers(false)
    const { fake } = await mount('full', true)
    await busyChat(fake)
    await expect.poll(() => infiniteAnimations().length).toBeGreaterThan(0)
  })

  it('Reduced mode runs none', async () => {
    const { fake } = await mount('reduced', true)
    await busyChat(fake)
    await expect.poll(motionOf).toBe('reduced')
    expect(infiniteAnimations().map((a) => (a as CSSAnimation).animationName)).toEqual([])
  })

  it.each(BUSY_ANIMATION_IDS.flatMap((animation) => BUSY_COLOR_IDS.map((color) => [animation, color] as const)))(
    'Reduced mode runs none for the %s working animation in %s, and still draws it',
    async (busyAnimation, busyAnimationColor) => {
      const { fake } = await renderApp({ settings: { transcriptChat: true, motion: 'reduced', busyAnimation, busyAnimationColor } })
      await busyChat(fake)
      await expect.poll(motionOf).toBe('reduced')
      expect(infiniteAnimations().map((a) => (a as CSSAnimation).animationName)).toEqual([])
      const marks = document.querySelectorAll('[data-testid="chat-working"] :is(.busy-dot, .busy-spark)')
      expect(marks.length).toBeGreaterThan(0)
    },
  )
})
