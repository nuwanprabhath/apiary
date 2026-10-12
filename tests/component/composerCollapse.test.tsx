import { describe, it, expect, beforeEach } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { sidebarSession, until } from './helpers'
import type { FakeApiary } from './fakeApiary'
import { emptyChatState } from '@shared/domain/chat'
import { asSessionId } from '@shared/domain/ids'

const TITLE = 'Fix CSV export bug'

const count = (id: string): number => document.querySelectorAll(`[data-testid="${id}"]`).length
const input = (): HTMLTextAreaElement => document.querySelector<HTMLTextAreaElement>('[data-testid="composer-input"]')!

async function open(): Promise<FakeApiary> {
  const { fake } = await renderApp({ settings: { transcriptChat: true } })
  await userEvent.click(sidebarSession(TITLE))
  await expect.element(page.getByTestId('composer')).toBeVisible()
  return fake
}

const fold = (): Promise<void> => userEvent.click(page.getByTestId('composer-collapse'))

describe('composer collapse', () => {
  beforeEach(() => { localStorage.removeItem('apiary.composerCollapsed') })

  it('the chevron hides the box and its handle; the row keeps working', async () => {
    await open()
    await fold()
    await until(() => count('composer-input') === 0)
    expect(count('composer-resize')).toBe(0)
    await expect.element(page.getByTestId('composer-collapse')).toHaveAttribute('aria-expanded', 'false')
    await expect.element(page.getByTestId('composer-send')).toBeVisible()
    await expect.element(page.getByTestId('composer-send')).toBeDisabled()
  })

  it('the chevron and "Message Claude…" both unfold it and focus the box', async () => {
    await open()
    await fold()
    await until(() => count('composer-input') === 0)
    await fold()
    await until(() => count('composer-input') === 1 && document.activeElement === input())
    await expect.element(page.getByTestId('composer-collapse')).toHaveAttribute('aria-expanded', 'true')

    await fold()
    await userEvent.click(page.getByTestId('composer-peek'))
    await until(() => count('composer-input') === 1 && document.activeElement === input())
  })

  it('stays folded across a remount and in a second pane', async () => {
    await open()
    await fold()
    await userEvent.click(page.getByTestId('session-tab-split').first())
    await until(() => count('composer') >= 1)
    await userEvent.keyboard('{Escape}')
    expect(count('composer-input')).toBe(0)
    expect(localStorage.getItem('apiary.composerCollapsed')).toBe('true')
    await open()
    expect(count('composer-input')).toBe(0)
  })

  it('shows the draft first line, keeps it, and sends it while folded', async () => {
    const fake = await open()
    await userEvent.fill(page.getByTestId('composer-input'), 'first line of a draft\nsecond')
    await fold()
    await expect.element(page.getByTestId('composer-peek')).toHaveTextContent('first line of a draft')
    expect(document.querySelector('[data-testid="composer-peek"]')!.textContent).not.toContain('second')
    await userEvent.click(page.getByTestId('composer-send'))
    await until(() => fake.callsTo('chatSend').length === 1)
    expect(fake.callsTo('chatSend')[0]?.[1]).toBe('first line of a draft\nsecond')
  })

  it('keeps the draft after unfolding', async () => {
    await open()
    await userEvent.fill(page.getByTestId('composer-input'), 'keep me')
    await fold()
    await until(() => count('composer-input') === 0)
    await fold()
    await until(() => count('composer-input') === 1)
    expect(input().value).toBe('keep me')
  })

  it('Stop interrupts a busy chat while folded', async () => {
    const fake = await open()
    const sessionId = fake.state.sessions.find((s) => s.title === TITLE)!.sessionId
    await fold()
    const next = { ...emptyChatState(asSessionId(sessionId)), status: 'busy' as const }
    fake.state.chats.set(sessionId, next)
    fake.emit('chatChanged', next)
    await userEvent.click(page.getByTestId('composer-stop'))
    await until(() => fake.callsTo('chatInterrupt').length === 1)
    expect(fake.callsTo('chatInterrupt')[0]).toEqual([sessionId])
  })

  it('folding makes the composer shorter by at least the box', async () => {
    await open()
    const box = input().getBoundingClientRect().height
    const composer = (): Element => document.querySelector('[data-testid="composer"]')!
    const before = composer().getBoundingClientRect().height
    await fold()
    await until(() => count('composer-input') === 0)
    expect(before - composer().getBoundingClientRect().height).toBeGreaterThanOrEqual(box)
  })
})
