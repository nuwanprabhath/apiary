import { describe, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from '../renderApp'
import { message as said } from '../fakeApiary'
import { until } from '../helpers'
import { message, withMrDesk } from '../residentFixtures'
import { must } from '../must'
import { reviewUi } from './review'

const CODE = 'aws logs describe-log-groups --profile prod-profile --region ap-southeast-2 --query "logGroups[].logGroupName" --output text'

describe('chat polish', () => {
  it('title links and a heads-up from the terminal', async () => {
    const { fake } = await renderApp({
      settings: { transcriptChat: true },
      sessions: [{
        sessionId: '00000000-0000-4000-8000-0000000000d1', title: '!1776 #3258 Staging failed to update error', projectPath: '/fixture/repo-c',
        messages: [said('u1', 'user', 'Find the log group.'), said('a1', 'assistant', `Check it:\n\n\`\`\`\n${CODE} ${CODE}\n\`\`\``)],
      }],
    }, (f) => {
      f.override('gitlabMrRefStatus', async () => ({ 1776: 'merged' }))
      must(f.state.projects.find((p) => p.path === '/fixture/repo-c')).webLocation = { forge: 'gitlab', webUrl: 'https://gitlab.com/group/project' }
    })
    await userEvent.click(page.getByTestId('sidebar').getByText('Staging failed to update error', { exact: false }).last())
    await userEvent.click(page.getByTestId('resume-button'))
    await userEvent.click(page.getByTestId('view-transcript'))
    const notice = {
      tag: 'Heads up',
      text: 'The new build checkbox will only appear for branches that already contain the change, so the hotfix branch in your screenshot won\'t show it.',
      choices: [{ key: '1', label: 'Learn more' }, { key: '2', label: 'Knew this already' }, { key: '0', label: 'Dismiss' }],
    }
    fake.override('activeTabs', async () => fake.state.tabs.map((t) => (t.key === '00000000-0000-4000-8000-0000000000d1' ? { ...t, notice } : t)))
    fake.emit('activeTabsChanged')
    await until(() => document.querySelector('[data-testid="chat-terminal-notice"]') !== null)
    await until(() => document.querySelectorAll('[data-testid="session-title"] a.ref-link').length === 2)
    await reviewUi('chat polish session', { within: () => document.querySelector('.session-column') })
  })

  it('a wrapped table in the MR desk', async () => {
    await renderApp({}, (f) => {
      withMrDesk(f)
      f.override('residentHistory', async () => [message('assistant', '| Your ask | Status |\n| --- | --- |\n'
        + '| Confirm whether to block or flag a missing photo | Done. Huy agreed with Walid and Andrew to skip only the affected record. |\n'
        + '| Exporter key has `s3:GetObject` before deploy | Only in the deploy checklist. Not confirmed. |')])
    })
    await until(() => document.querySelector('[data-testid="resident-badge-mr-desk"]') !== null)
    await userEvent.click(document.querySelector('[data-testid="resident-badge-mr-desk"]')!)
    await until(() => document.querySelector('.resident-popup table') !== null)
    await reviewUi('chat polish mr desk table', { within: () => document.querySelector('[data-testid="resident-popup"]') })
  })

  it('find in the MR desk', async () => {
    await renderApp({}, (f) => {
      withMrDesk(f)
      f.override('residentHistory', async () => [message('user', 'What is waiting on me?'), message('assistant', 'Your reopened 4.1 thread on !1761: say resolve, or draft 1.1.')])
    })
    await until(() => document.querySelector('[data-testid="resident-badge-mr-desk"]') !== null)
    await userEvent.click(document.querySelector('[data-testid="resident-badge-mr-desk"]')!)
    await until(() => document.querySelector('[data-testid="resident-conversation"]')?.textContent.includes('reopened') === true)
    await userEvent.click(page.getByTestId('resident-conversation'))
    await userEvent.keyboard('{Meta>}f{/Meta}thread')
    await until(() => document.querySelector('[data-testid="find-count"]')?.textContent === '1 of 1')
    await reviewUi('chat polish mr desk find', { within: () => document.querySelector('[data-testid="resident-popup"]') })
  })
})
