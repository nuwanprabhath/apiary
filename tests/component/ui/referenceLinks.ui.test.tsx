import { describe, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { renderApp } from '../renderApp'
import { message } from '../fakeApiary'
import { sidebarSession, until } from '../helpers'
import { must } from '../must'
import { reviewUi } from './review'

const TEXT = 'Add "Script error." to `dev/1.0.13` under #3202.\n\nPort !1713 plus that change, then close other/project#12. '
  + 'The fix is in src/app.ts.'

async function open(chat: boolean): Promise<void> {
  await renderApp({
    settings: { transcriptChat: chat },
    vsCode: true,
    sessions: [{
      sessionId: 'refs',
      title: 'Reference links',
      projectPath: '/fixture/repo-c',
      messages: [message('u1', 'user', 'What next?'), message('a1', 'assistant', TEXT)],
    }],
  }, (fake) => {
    must(fake.state.projects.find((p) => p.path === '/fixture/repo-c')).webLocation = { forge: 'gitlab', webUrl: 'https://gitlab.com/group/project' }
  })
  await userEvent.click(sidebarSession('Reference links'))
  await until(() => document.querySelectorAll('a.ref-link').length === 3)
}

describe('reference links', () => {
  it('reference links chat', async () => {
    await open(true)
    await reviewUi('reference links chat', { within: () => document.querySelector('[data-testid="transcript"]') })
  })

  it('reference links transcript', async () => {
    await open(false)
    await reviewUi('reference links transcript', { within: () => document.querySelector('[data-testid="transcript"]') })
  })
})
