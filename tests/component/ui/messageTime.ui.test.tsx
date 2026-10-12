import { describe, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { renderApp } from '../renderApp'
import { message } from '../fakeApiary'
import { sidebarSession, until } from '../helpers'
import { reviewUi } from './review'

const TS = new Date(2026, 9, 10, 10, 29).getTime()
const DAY = 24 * 60 * 60 * 1000

async function open(chat: boolean): Promise<void> {
  await renderApp({
    settings: { transcriptChat: chat },
    sessions: [{
      sessionId: 'timed',
      title: 'Timed session',
      projectPath: '/fixture/repo-c',
      messages: [
        message('u1', 'user', 'list the sources', { timestampMs: TS - 400 * DAY }),
        message('a1', 'assistant', 'Two folders.', { timestampMs: TS - 400 * DAY + 3 * 60_000 }),
        message('u2', 'user', 'now the tests, and a long question that wraps over several lines in a narrow pane so the time above it must not collide with the role label', { timestampMs: TS - DAY }),
        message('a2', 'assistant', 'Two folders: tests/unit and tests/component, and a reply that is long enough to wrap in a narrow pane.', { timestampMs: TS }),
        message('a3', 'assistant', 'Short.', { timestampMs: TS + 5_000 }),
        message('a4', 'assistant', '# A heading first\n\nThen some text.', { timestampMs: TS + 10_000 }),
        message('a5', 'assistant', '```ts\nconst answer = 42 // a code block first, long enough to reach the right edge of a narrow pane\n```', { timestampMs: TS + 15_000 }),
      ],
    }],
  })
  await userEvent.click(sidebarSession('Timed session'))
  await until(() => document.querySelectorAll('[data-testid="message-time"]').length >= 2)
}

describe('message times', () => {
  it('message times transcript', async () => {
    await open(false)
    await reviewUi('message times transcript')
  })

  it('message times chat', async () => {
    await open(true)
    await reviewUi('message times chat')
  })

  it('message times narrow', async () => {
    await open(false)
    await reviewUi('message times narrow', {
      widths: [620],
      // The composer's clipped hint at this width is a known defect of another package.
      within: () => document.querySelector('[data-testid="transcript"]'),
    })
  })
})
