import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { emptyChatState } from '@shared/domain/chat'
import { asSessionId } from '@shared/domain/ids'
import { BUSY_ANIMATION_IDS } from '@shared/domain/busyAnimation'
import type { AppSettingsPayload } from '@shared/domain/settings'
import { renderApp } from './renderApp'
import { sidebarSession, until } from './helpers'

/** The animation beside "Claude is working": chosen in Settings → Themes, drawn on the working line. */
const TITLE = 'Fix CSV export bug'

async function busyChat(settings: Partial<AppSettingsPayload> = {}): Promise<Awaited<ReturnType<typeof renderApp>>> {
  const mounted = await renderApp({ settings: { transcriptChat: true, motion: 'full', ...settings } })
  const { fake } = mounted
  await userEvent.click(sidebarSession(TITLE))
  await expect.element(page.getByTestId('chat-timeline')).toBeVisible()
  const sessionId = fake.state.sessions.find((s) => s.title === TITLE)!.sessionId
  const next = { ...emptyChatState(asSessionId(sessionId)), status: 'busy' as const, turnStartedAt: Date.now() }
  fake.state.chats.set(sessionId, next)
  fake.emit('chatChanged', { kind: 'full', state: next })
  await expect.element(page.getByTestId('chat-working')).toBeVisible()
  return mounted
}

const glyph = (): HTMLElement | null => document.querySelector('[data-testid="chat-working"] .busy-glyph')

async function openThemes(fake: Awaited<ReturnType<typeof renderApp>>['fake']): Promise<void> {
  fake.emit('openSettingsDialog')
  await until(() => document.querySelector('[data-testid="settings-dialog"]') !== null)
  await userEvent.click(page.getByTestId('settings-nav-themes'))
}

describe('working animation', () => {
  it('is the spark in the theme accent by default', async () => {
    await busyChat()
    expect(glyph()?.dataset.busyAnimation).toBe('spark')
    expect(glyph()?.dataset.busyColor).toBe('theme')
  })

  it('draws the chosen animation, in the chosen colour, and tints the verb to match', async () => {
    await busyChat({ busyAnimation: 'orbit', busyAnimationColor: 'claude' })
    expect(glyph()?.dataset.busyAnimation).toBe('orbit')
    expect(glyph()?.querySelectorAll('.busy-dot')).toHaveLength(3)
    const claude = getComputedStyle(document.documentElement).getPropertyValue('--claude').trim()
    const probe = document.createElement('span')
    probe.style.color = claude
    document.body.append(probe)
    const expected = getComputedStyle(probe).color
    probe.remove()
    expect(getComputedStyle(glyph()!.querySelector('.busy-dot')!).backgroundColor).toBe(expected)
    expect(getComputedStyle(document.querySelector('.chat-working-verb')!).color).toBe(expected)
  })

  it('the orbit moves: its planets are somewhere else a moment later', async () => {
    await busyChat({ busyAnimation: 'orbit' })
    const where = (): string => [...glyph()!.querySelectorAll('.busy-dot')].map((d) => getComputedStyle(d).transform).join('|')
    const first = where()
    await expect.poll(where).not.toBe(first)
  })

  it('choosing one in Settings applies it at once, and saving the dialog later keeps it', async () => {
    const { fake } = await busyChat()
    await openThemes(fake)
    await userEvent.click(page.getByTestId('busy-animation-comet'))
    await until(() => glyph()?.dataset.busyAnimation === 'comet')
    expect(glyph()?.querySelectorAll('.busy-dot')).toHaveLength(9)
    await userEvent.click(page.getByTestId('busy-color-aurora'))
    await until(() => glyph()?.dataset.busyColor === 'aurora')

    await userEvent.click(page.getByTestId('settings-nav-sidebar'))
    await userEvent.click(page.getByTestId('setting-hide-old-enabled'))
    await userEvent.click(page.getByTestId('settings-save'))
    await until(() => document.querySelector('[data-testid="settings-dialog"]') === null)
    const saved = await window.apiary.settingsGet()
    expect([saved.busyAnimation, saved.busyAnimationColor]).toEqual(['comet', 'aurora'])
  })

  it('the picker shows every animation, live, with the chosen one marked', async () => {
    const { fake } = await busyChat({ busyAnimation: 'atom' })
    await openThemes(fake)
    for (const id of BUSY_ANIMATION_IDS) {
      await expect.element(page.getByTestId(`busy-animation-${id}`)).toBeVisible()
      expect(document.querySelector(`[data-testid="busy-animation-${id}"] .busy-glyph`)?.getAttribute('data-busy-animation')).toBe(id)
    }
    await expect.element(page.getByTestId('busy-animation-atom')).toHaveAttribute('data-active', 'true')
    await expect.element(page.getByRole('radio', { name: /Atom/ })).toBeChecked()
  })

  it('arrow keys move between the animations', async () => {
    const { fake } = await busyChat()
    await openThemes(fake)
    page.getByRole('radio', { name: /Spark/ }).element().focus()
    await userEvent.keyboard('{ArrowRight}')
    await expect.poll(() => glyph()?.dataset.busyAnimation).toBe('orbit')
    await expect.element(page.getByRole('radio', { name: /Orbit/ })).toBeChecked()
  })
})
