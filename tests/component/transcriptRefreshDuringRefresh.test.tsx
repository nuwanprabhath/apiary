import { describe, it, expect } from 'vitest'
import { userEvent } from 'vitest/browser'
import type { TranscriptPage } from '@shared/types'
import { renderApp } from './renderApp'
import { message, type FakeSession } from './fakeApiary'
import { sidebarSession, until } from './helpers'

const TITLE = 'Busy terminal session'
const SESSION_ID = '77777777-7777-4777-8777-777777777777'

const session = (): FakeSession => ({
  sessionId: SESSION_ID, title: TITLE, projectPath: '/fixture/work-a', gitBranch: 'main',
  messages: [message('m0', 'user', 'first question'), message('m1', 'assistant', 'working on it')],
})

const shows = (text: string): boolean =>
  [...document.querySelectorAll('[data-testid="message"]')].some((r) => r.textContent?.includes(text) === true)

describe('a transcript that changes while it is being read', () => {
  // A message typed into a busy terminal from the chat view was written to the file while the view
  // was still reading the previous change; that change was dropped, the session went quiet, and the
  // message showed only after switching to the terminal and back.
  it('reads again once the read in flight lands, so the last write is not lost', async () => {
    const { fake } = await renderApp({ sessions: [session()] })
    await userEvent.click(sidebarSession(TITLE))
    await until(() => shows('working on it'))

    let release = (): void => {}
    const gate = new Promise<void>((r) => { release = r })
    // Answers with the file as it was when asked, then waits: the read in flight.
    fake.override('transcriptAfter', async (...args): Promise<TranscriptPage> => {
      fake.restore('transcriptAfter')
      const page = await fake.transcriptAfter(...args)
      await gate
      return page
    })
    const s = fake.state.sessions.find((x) => x.sessionId === SESSION_ID)!
    s.messages!.push(message('m2', 'assistant', 'ran 2 shell commands'))
    fake.emit('treeChanged')
    await expect.poll(() => fake.callsTo('transcriptAfter').length).toBeGreaterThan(0)

    s.messages!.push(message('m3', 'user', 'FYI just logged in to the app for you'))
    fake.emit('treeChanged')
    release()

    await expect.poll(() => shows('ran 2 shell commands')).toBe(true)
    await expect.poll(() => shows('FYI just logged in to the app for you')).toBe(true)
  })
})
