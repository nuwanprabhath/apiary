import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import type { TranscriptMessage } from '@shared/types'
import { TRANSCRIPT_PAGE_SIZE } from '@shared/types'
import { HELD_MAX } from '../../src/renderer/state/transcriptWindow'
import { renderApp } from './renderApp'
import { message, type FakeApiary, type FakeSession } from './fakeApiary'
import { sidebarSession, stays, until } from './helpers'

const MAC = navigator.userAgent.includes('Mac')
const FIND = MAC ? '{Meta>}f{/Meta}' : '{Control>}f{/Control}'

const TITLE = 'Windowed session'
const SESSION_ID = '66666666-6666-4666-8666-666666666666'
const TOTAL = 1500

const text = (i: number): string => 'msg-' + String(i).padStart(5, '0')
const make = (i: number): TranscriptMessage => message('w' + String(i), i % 2 === 0 ? 'user' : 'assistant', text(i))

const session = (): FakeSession => ({
  sessionId: SESSION_ID, title: TITLE, projectPath: '/fixture/work-a', gitBranch: 'main',
  messages: Array.from({ length: TOTAL }, (_, i) => make(i)),
})

const rows = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-testid="message"]')]
const scroller = (): HTMLElement => document.querySelector<HTMLElement>('[data-testid="transcript"]')!
const held = (): number => rows().length
const hasText = (i: number): boolean => rows().some((r) => r.textContent?.includes(text(i)) === true)

async function open(): Promise<FakeApiary> {
  const { fake } = await renderApp({ sessions: [session()] })
  await userEvent.click(sidebarSession(TITLE))
  await until(() => held() === TRANSCRIPT_PAGE_SIZE)
  await expect.poll(() => scroller().scrollHeight - scroller().scrollTop - scroller().clientHeight).toBeLessThan(5)
  return fake
}

/** Appends `n` messages to the session's file and tells the window the tree changed, as main does. */
function arrive(fake: FakeApiary, n: number): void {
  const s = fake.state.sessions.find((x) => x.sessionId === SESSION_ID)!
  const from = s.messages!.length
  for (let i = 0; i < n; i++) s.messages!.push(make(from + i))
  fake.emit('treeChanged')
}

describe('a transcript holds a bounded window of messages', () => {
  it('never mounts more than HELD_MAX rows while it follows streaming arrivals, and loads only what is new', async () => {
    const fake = await open()
    let most = 0
    for (let b = 0; b < 6; b++) {
      arrive(fake, 150)
      await expect.poll(() => hasText(TOTAL - 1 + (b + 1) * 150)).toBe(true)
      most = Math.max(most, held())
    }
    expect(most).toBeLessThanOrEqual(HELD_MAX)
    expect(held()).toBeLessThanOrEqual(HELD_MAX)
    expect(held()).toBeGreaterThan(300)
    // The refresh asked only for what followed the last held message, never the newest page.
    expect(fake.callsTo('transcriptAfter').length).toBeGreaterThan(0)
    expect(fake.callsTo('transcript').filter((a) => a[1] === undefined)).toHaveLength(1)
  })

  it('scrolling to the top loads the earlier page by itself, and the row at the top stays in place', async () => {
    await open()
    expect(hasText(TOTAL - TRANSCRIPT_PAGE_SIZE - 1)).toBe(false)
    const el = scroller()
    const first = rows()[0]
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: -10, bubbles: true }))
    el.scrollTop = 0
    await until(() => held() === 2 * TRANSCRIPT_PAGE_SIZE)
    // Scroll anchoring keeps the row that was first where it was: it is no longer at scrollTop 0.
    await expect.poll(() => Math.abs(first.getBoundingClientRect().top - el.getBoundingClientRect().top)).toBeLessThan(el.clientHeight)
    expect(el.scrollTop).toBeGreaterThan(0)
  })

  it('does not trim while scrolled up, however many messages arrive', async () => {
    const fake = await open()
    const el = scroller()
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: -10, bubbles: true }))
    el.scrollTop -= 20
    el.dispatchEvent(new Event('scroll'))
    const reading = rows().find((r) => r.getBoundingClientRect().top > el.getBoundingClientRect().top)!
    const readingText = reading.textContent
    for (let b = 0; b < 4; b++) {
      const calls = fake.callsTo('transcriptAfter').length
      arrive(fake, 150)
      await until(() => fake.callsTo('transcriptAfter').length > calls)
    }
    await until(() => held() > HELD_MAX)
    expect(held()).toBe(TRANSCRIPT_PAGE_SIZE + 600)
    expect(rows().some((r) => r.textContent === readingText)).toBe(true)
  })

  it('does not trim while the find bar is open', async () => {
    const fake = await open()
    await userEvent.click(page.getByTestId('transcript'))
    await userEvent.keyboard(FIND)
    await expect.element(page.getByTestId('find-bar')).toBeVisible()
    for (let b = 0; b < 4; b++) {
      const calls = fake.callsTo('transcriptAfter').length
      arrive(fake, 150)
      await until(() => fake.callsTo('transcriptAfter').length > calls)
    }
    await until(() => held() > HELD_MAX)
    await stays(() => held() === TRANSCRIPT_PAGE_SIZE + 600, 300, 'nothing is trimmed with find open')
  })

  it('shows trimmed messages again when you scroll back up', async () => {
    const fake = await open()
    for (let b = 0; b < 6; b++) {
      arrive(fake, 150)
      await expect.poll(() => hasText(TOTAL - 1 + (b + 1) * 150)).toBe(true)
    }
    // The messages just before the first one still held are the ones that were dropped.
    const oldest = Number(/msg-(\d+)/.exec(rows()[0].textContent)![1]) - 1
    expect(oldest).toBeGreaterThan(TOTAL - TRANSCRIPT_PAGE_SIZE)
    expect(hasText(oldest)).toBe(false)
    const el = scroller()
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: -10, bubbles: true }))
    el.scrollTop = 0
    await expect.poll(() => hasText(oldest)).toBe(true)
  })
})
