import { describe, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from '../renderApp'
import { mouse, sidebarSession, until } from '../helpers'
import { reviewUi } from './review'

const PROMPT = 'Nightly pipeline check for the dev branch (working folder /home/me/pipelines/monitor13). '.repeat(20).trim()

describe('hover card title', () => {
  it('hover card long prompt title', async () => {
    await renderApp({ sessions: [{ sessionId: 'long-prompt', title: PROMPT, projectPath: '/fixture/repo-c' }] })
    await reviewUi('hover card long prompt title', {
      open: async () => {
        await userEvent.hover(sidebarSession(PROMPT))
        await until(() => page.getByTestId('session-hover-card').elements().length === 1)
      },
      close: async () => { await mouse.move(900, 700, 5) },
    })
  })
})
