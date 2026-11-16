import { describe, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { renderApp } from '../renderApp'
import { message } from '../fakeApiary'
import { sidebarSession, until } from '../helpers'
import { reviewUi } from './review'

const LINK = 'https://gitlab.com/example-group/example-project/-/pipelines/3072612345678901234567890?ref=feature/a-very-long-branch-name-without-spaces'

async function open(chat: boolean): Promise<void> {
  await renderApp({
    settings: { transcriptChat: chat },
    sessions: [{
      sessionId: 'linked',
      title: 'Linked session',
      projectPath: '/fixture/repo-c',
      messages: [
        message('u1', 'user', `I got email saying this failed, so watch pipelines based on your pushes. ${LINK}`),
        message('a1', 'assistant', `Watching it now:\n\n${LINK}\n\n| Limit | Runs on |\n| --- | --- |\n| wildobs | just that one |`),
      ],
    }],
  })
  await userEvent.click(sidebarSession('Linked session'))
  await until(() => document.querySelectorAll('a[href^="https://gitlab.com"]').length >= 2)
}

describe('long links', () => {
  it('long link chat', async () => {
    await open(true)
    await reviewUi('long link chat', { within: () => document.querySelector('[data-testid="transcript"]') })
  })

  it('long link transcript', async () => {
    await open(false)
    await reviewUi('long link transcript', { within: () => document.querySelector('[data-testid="transcript"]') })
  })
})
