import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import type { TranscriptMessage } from '@shared/types'
import { TRANSCRIPT_PAGE_SIZE } from '@shared/types'
import { renderApp } from './renderApp'
import { message, type FakeSession } from './fakeApiary'
import { openClaudeTerminal, ptyWrites, sidebarSession, stays, until } from './helpers'

// The chord that opens the find bar on this platform, and the other modifier's chord, which must not.
const MAC = navigator.userAgent.includes('Mac')
const FIND = MAC ? '{Meta>}f{/Meta}' : '{Control>}f{/Control}'
const OTHER_MODIFIER_F = MAC ? '{Control>}f{/Control}' : '{Meta>}f{/Meta}'

let sessionCount = 0
function sessionWith(title: string, messages: TranscriptMessage[]): FakeSession {
  sessionCount += 1
  return {
    sessionId: `00000000-0000-4000-8000-${String(sessionCount).padStart(12, '0')}`,
    title,
    projectPath: '/fixture/work-a',
    gitBranch: 'main',
    messages,
  }
}

// Six matches for "csv", case-insensitively: one, three, one and one.
const csvChat = (): TranscriptMessage[] => [
  message('u1', 'user', 'Can you help me with CSV?'),
  message('a1', 'assistant', 'The CSV file format is text-based. CSV means comma-separated values. You can open CSV files in Excel.'),
  message('u2', 'user', 'Great! What about CSV parsing?'),
  message('a2', 'assistant', 'CSV parsing requires careful handling of quotes and commas within fields.'),
]

const findBar = (): Element | null => document.querySelector('[data-testid="find-bar"]')
const countText = (): string => document.querySelector('[data-testid="find-count"]')?.textContent?.trim() ?? ''
const highlightSize = (name: string): number => CSS.highlights.get(name)?.size ?? 0
const messageEls = (): Element[] => [...document.querySelectorAll('[data-testid="message"]')]

/** Whether `el` lies wholly inside the transcript's visible area. */
function inView(el: Element | undefined): boolean {
  const view = document.querySelector('[data-testid="transcript"]')?.getBoundingClientRect()
  if (el === undefined || view === undefined) return false
  const r = el.getBoundingClientRect()
  return r.top >= view.top && r.bottom <= view.bottom
}

/** Opens `title` and clicks into its transcript, as a reader would before pressing the chord. */
async function openTranscript(title: string): Promise<void> {
  await userEvent.click(sidebarSession(title))
  await until(() => page.getByTestId('message').elements().length > 0)
  await userEvent.click(page.getByTestId('transcript'))
}

describe('the find chord', () => {
  it('opens the bar with the platform chord, and the field takes focus', async () => {
    await renderApp({ sessions: [sessionWith('Find test', csvChat())] })
    await openTranscript('Find test')
    await userEvent.keyboard(FIND)
    await expect.element(page.getByTestId('find-bar')).toBeVisible()
    await expect.element(page.getByTestId('find-input')).toHaveFocus()
  })

  it('ignores the other modifier', async () => {
    await renderApp({ sessions: [sessionWith('Find test', csvChat())] })
    await openTranscript('Find test')
    await userEvent.keyboard(OTHER_MODIFIER_F)
    await stays(() => findBar() === null, 300, 'no find bar')
  })

  it('Escape closes the bar and gives the transcript its focus back', async () => {
    await renderApp({ sessions: [sessionWith('Find test', csvChat())] })
    await openTranscript('Find test')
    await userEvent.keyboard(FIND)
    await expect.element(page.getByTestId('find-input')).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByTestId('find-bar')).not.toBeInTheDocument()
    await expect.element(page.getByTestId('transcript')).toHaveFocus()
  })

  it('closes when another session is opened', async () => {
    await renderApp({ sessions: [sessionWith('Find test', csvChat()), sessionWith('Other chat', csvChat())] })
    await openTranscript('Find test')
    await userEvent.keyboard(FIND)
    await expect.element(page.getByTestId('find-bar')).toBeVisible()
    await userEvent.click(sidebarSession('Other chat'))
    await expect.element(page.getByTestId('find-bar')).not.toBeInTheDocument()
  })

  it('does not take the chord from a terminal, which needs Ctrl+F for itself', async () => {
    const { fake } = await renderApp()
    await openClaudeTerminal(fake)
    await userEvent.keyboard(FIND)
    await stays(() => findBar() === null, 300, 'no find bar over a terminal')
    await userEvent.keyboard('{Control>}f{/Control}')
    await until(() => ptyWrites(fake).includes('\x06'))
  })

  it('works from the composer, which belongs to the transcript pane', async () => {
    await renderApp({ sessions: [sessionWith('Find test', csvChat())] })
    await openTranscript('Find test')
    await userEvent.click(page.getByTestId('composer-input'))
    await userEvent.keyboard(FIND)
    await expect.element(page.getByTestId('find-bar')).toBeVisible()
  })
})

describe('find matches', () => {
  it('counts every match in the whole transcript, ignoring case', async () => {
    await renderApp({ sessions: [sessionWith('Find test', csvChat())] })
    await openTranscript('Find test')
    await userEvent.keyboard(FIND)
    await userEvent.type(page.getByTestId('find-input'), 'csv')
    await expect.poll(countText).toBe('6 of 6')
  })

  it('starts at the newest match: its highlight is current and it is in view', async () => {
    await renderApp({ sessions: [sessionWith('Find test', csvChat())] })
    await openTranscript('Find test')
    await userEvent.keyboard(FIND)
    await userEvent.type(page.getByTestId('find-input'), 'csv')
    await expect.poll(countText).toBe('6 of 6')
    const current = (): Range | undefined => [...(CSS.highlights.get('transcript-find-current') ?? [])][0] as Range | undefined
    await expect.poll(() => current()?.startContainer.parentElement?.closest('[data-testid="message"]')).toBe(messageEls()[3])
    expect(inView(current()?.startContainer.parentElement ?? undefined)).toBe(true)
  })

  it('Enter steps to the older match and Shift+Enter to the newer, wrapping at both ends', async () => {
    await renderApp({ sessions: [sessionWith('Find prev test', [message('u1', 'user', 'test test test')])] })
    await openTranscript('Find prev test')
    await userEvent.keyboard(FIND)
    await userEvent.type(page.getByTestId('find-input'), 'test')
    await expect.poll(countText).toBe('3 of 3')
    await userEvent.keyboard('{Enter}')
    await expect.poll(countText).toBe('2 of 3')
    await userEvent.keyboard('{Shift>}{Enter}{/Shift}')
    await expect.poll(countText).toBe('3 of 3')
    await userEvent.keyboard('{Shift>}{Enter}{/Shift}')
    await expect.poll(countText).toBe('1 of 3')
    await userEvent.keyboard('{Enter}')
    await expect.poll(countText).toBe('3 of 3')
  })

  it('the up button goes to the older match and the down button to the newer', async () => {
    const apples = [message('u1', 'user', 'Find apple, apple, apple'), message('a1', 'assistant', 'Here are your apples')]
    await renderApp({ sessions: [sessionWith('Find nav test', apples)] })
    await openTranscript('Find nav test')
    await userEvent.keyboard(FIND)
    await userEvent.type(page.getByTestId('find-input'), 'apple')
    await expect.poll(countText).toBe('4 of 4')
    await userEvent.click(page.getByTestId('find-prev'))
    await expect.poll(countText).toBe('3 of 4')
    await userEvent.click(page.getByTestId('find-prev'))
    await expect.poll(countText).toBe('2 of 4')
    await userEvent.click(page.getByTestId('find-next'))
    await expect.poll(countText).toBe('3 of 4')
    await userEvent.click(page.getByTestId('find-next'))
    await userEvent.click(page.getByTestId('find-next'))
    await expect.poll(countText).toBe('1 of 4')
  })

  it('pressing the chord again starts over from the newest match', async () => {
    await renderApp({ sessions: [sessionWith('Find again', csvChat())] })
    await openTranscript('Find again')
    await userEvent.keyboard(FIND)
    await userEvent.type(page.getByTestId('find-input'), 'csv')
    await userEvent.keyboard('{Enter}{Enter}')
    await expect.poll(countText).toBe('4 of 6')
    await userEvent.keyboard(FIND)
    await expect.poll(countText).toBe('6 of 6')
  })

  it('paints every match, and clears the paint when the bar closes', async () => {
    await renderApp({ sessions: [sessionWith('Find test', csvChat())] })
    await openTranscript('Find test')
    await userEvent.keyboard(FIND)
    await userEvent.type(page.getByTestId('find-input'), 'csv')
    await expect.poll(() => highlightSize('transcript-find')).toBe(6)
    await expect.poll(() => highlightSize('transcript-find-current')).toBe(1)
    await userEvent.keyboard('{Escape}')
    await expect.poll(() => highlightSize('transcript-find')).toBe(0)
    await expect.poll(() => highlightSize('transcript-find-current')).toBe(0)
  })
})

describe('find jumping', () => {
  it('scrolls the current match into view, going up and coming back down', async () => {
    const filler = Array.from({ length: 40 }, (_, i) =>
      message(`f${i}`, i % 2 === 0 ? 'user' : 'assistant', `Filler line ${i}, long enough to take up a row of its own.`))
    const chat = [message('top', 'user', 'needle at the top'), ...filler, message('bottom', 'assistant', 'needle at the bottom')]
    await renderApp({ sessions: [sessionWith('Long chat', chat)] })
    await openTranscript('Long chat')
    await userEvent.keyboard(FIND)
    await userEvent.type(page.getByTestId('find-input'), 'needle')
    await expect.poll(countText).toBe('2 of 2')
    await expect.poll(() => inView(messageEls()[messageEls().length - 1])).toBe(true)
    await userEvent.click(page.getByTestId('find-prev'))
    await expect.poll(countText).toBe('1 of 2')
    await expect.poll(() => inView(messageEls()[0])).toBe(true)
  })

  it('pages in earlier messages so that they can match', async () => {
    const history = Array.from({ length: TRANSCRIPT_PAGE_SIZE + 50 }, (_, i) =>
      message(`m${i}`, i % 2 === 0 ? 'user' : 'assistant', i === 10 ? 'the buried needle' : `message ${i}`))
    await renderApp({ sessions: [sessionWith('Long history', history)] })
    await openTranscript('Long history')
    await expect.poll(() => messageEls().length).toBe(TRANSCRIPT_PAGE_SIZE)
    await userEvent.keyboard(FIND)
    await userEvent.type(page.getByTestId('find-input'), 'buried needle')
    await expect.poll(countText).toBe('1 of 1')
    await expect.poll(() => messageEls().length).toBe(history.length)
  })

  it('searches a message that arrives while the bar is open', async () => {
    const { fake } = await renderApp({ sessions: [sessionWith('Live chat', [message('u1', 'user', 'a needle')])] })
    await openTranscript('Live chat')
    await userEvent.keyboard(FIND)
    await userEvent.type(page.getByTestId('find-input'), 'needle')
    await expect.poll(countText).toBe('1 of 1')
    fake.state.sessions.find((s) => s.title === 'Live chat')?.messages?.push(message('a1', 'assistant', 'a second needle'))
    fake.emit('treeChanged')
    await expect.poll(countText).toBe('2 of 2')
  })
})

describe('the find widget', () => {
  it('floats over the transcript: the first message does not move when it opens', async () => {
    await renderApp({ sessions: [sessionWith('Find float', csvChat())] })
    await openTranscript('Find float')
    const top = (): number => messageEls()[0]?.getBoundingClientRect().top ?? -1
    const closed = top()
    await userEvent.keyboard(FIND)
    await expect.element(page.getByTestId('find-bar')).toBeVisible()
    expect(top()).toBe(closed)
    const bar = findBar()?.getBoundingClientRect()
    const view = document.querySelector('[data-testid="transcript"]')?.getBoundingClientRect()
    expect(bar?.width).toBeLessThanOrEqual(360)
    expect(bar?.top).toBeGreaterThanOrEqual(view?.top ?? 0)
  })

  it('with no matches says so, flags the field and disables stepping', async () => {
    await renderApp({ sessions: [sessionWith('Find none', csvChat())] })
    await openTranscript('Find none')
    await userEvent.keyboard(FIND)
    await userEvent.type(page.getByTestId('find-input'), 'zzzqqq')
    await expect.poll(countText).toBe('No results')
    await expect.element(page.getByTestId('find-prev')).toBeDisabled()
    await expect.element(page.getByTestId('find-next')).toBeDisabled()
    expect(document.querySelector('[data-testid="find-input"]')?.classList.contains('no-results')).toBe(true)
  })
})

describe('the find widget never covers message text', () => {
  const overlaps = (a: DOMRect, b: DOMRect): boolean =>
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

  for (const chat of [false, true]) {
    it(`leaves every message uncovered (${chat ? 'chat' : 'transcript'} mode)`, async () => {
      await renderApp({
        settings: chat ? { transcriptChat: true } : {},
        sessions: [sessionWith('Find overlap', csvChat())],
      })
      await userEvent.click(sidebarSession('Find overlap'))
      await until(() => document.querySelector('[data-testid="transcript"]') !== null)
      await userEvent.click(page.getByTestId('transcript'))
      await userEvent.keyboard(FIND)
      await until(() => document.querySelector('[data-testid="find-bar"]') !== null)
      const bar = document.querySelector('[data-testid="find-bar"]')!.getBoundingClientRect()
      const rows = [...document.querySelectorAll('[data-testid="transcript"] .message, [data-testid="transcript"] .chat-row')]
      expect(rows.length).toBeGreaterThan(0)
      for (const row of rows) expect(overlaps(bar, row.getBoundingClientRect())).toBe(false)
    })
  }
})
