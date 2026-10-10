import { describe, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from '../renderApp'
import { message } from '../fakeApiary'
import { sidebarSession, until } from '../helpers'
import { reviewUi } from './review'

/** The transcript find widget: with matches (the newest current), with none, and in a narrow pane. */
const MAC = navigator.userAgent.includes('Mac')
const FIND = MAC ? '{Meta>}f{/Meta}' : '{Control>}f{/Control}'
const press = async (keys: string): Promise<void> => { await userEvent.keyboard(keys) }

async function openFind(query: string, steps = 0): Promise<void> {
  await userEvent.click(page.getByTestId('transcript'))
  await press(FIND)
  await until(() => document.querySelector('[data-testid="find-bar"]') !== null)
  await userEvent.fill(page.getByTestId('find-input'), query)
  for (let i = 0; i < steps; i++) await press('{Enter}')
}

async function openSession(): Promise<void> {
  await renderApp({
    sessions: [{
      sessionId: '00000000-0000-4000-8000-0000000000f1',
      title: 'Fix CSV export bug',
      projectPath: '/fixture/work-a',
      gitBranch: 'main',
      messages: [
        message('u1', 'user', 'Can you help me with CSV?'),
        message('a1', 'assistant', 'The CSV file format is text-based. CSV means comma-separated values. You can open CSV files in Excel.'),
        message('u2', 'user', 'Great! What about CSV parsing?'),
        message('a2', 'assistant', 'CSV parsing requires careful handling of quotes and commas within fields.'),
      ],
    }],
  })
  await userEvent.click(sidebarSession('Fix CSV export bug'))
  await until(() => document.querySelector('[data-testid="transcript"]') !== null)
}

describe('UI: the transcript find widget', () => {
  it('find bar with matches', async () => {
    await openSession()
    await reviewUi('find bar with matches', {
      open: () => openFind('csv'),
      close: () => press('{Escape}'),
    })
  })

  it('find bar no results', async () => {
    await openSession()
    await reviewUi('find bar no results', {
      open: () => openFind('zzzqqq'),
      close: () => press('{Escape}'),
    })
  })

  it('find bar narrow pane', async () => {
    await openSession()
    await reviewUi('find bar narrow pane', {
      widths: [620],
      within: () => document.querySelector('[data-testid="transcript"]'),
      open: () => openFind('csv'),
      close: () => press('{Escape}'),
    })
  })
})
