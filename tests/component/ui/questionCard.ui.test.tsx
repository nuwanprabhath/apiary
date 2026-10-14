import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { until } from '../helpers'
import { ask, NAMES_INPUT, openChat, play } from '../questionFixture'
import { reviewUi } from './review'

/** Claude's question as a card in the conversation: one question, several, multi-select, "Other", a narrow window. */
const MULTI = {
  questions: [{
    question: 'Which checks should run before the commit?', header: 'Checks', multiSelect: true,
    options: [
      { label: 'Lint', description: 'ESLint, stylelint and the layer rules' },
      { label: 'Types (Recommended)', description: 'tsc over both tsconfigs' },
      { label: 'Tests', description: 'Unit, integration and component' },
    ],
  }],
}

const THREE = {
  questions: [
    NAMES_INPUT.questions[0],
    MULTI.questions[0],
    {
      question: 'Where should the list live?', header: 'Location', multiSelect: false,
      options: [{ label: 'Sidebar', description: 'Always visible' }, { label: 'Settings', description: 'Out of the way' }],
    },
  ],
}

async function show(input: unknown): Promise<void> {
  const { fake, sessionId } = await openChat()
  play(fake, sessionId, { status: 'busy', permissions: [ask(input)] })
  await until(() => document.querySelector('[data-testid="chat-question-card"]') !== null)
}

describe('UI: the question card', () => {
  it('one question with a long text and Recommended', async () => {
    await show(NAMES_INPUT)
    await reviewUi('question single', { widths: [700, 1000] })
  })

  it('a multi-select question with two rows chosen', async () => {
    await show(MULTI)
    await userEvent.click(page.getByTestId('chat-question-option-0'))
    await userEvent.click(page.getByTestId('chat-question-option-2'))
    await reviewUi('question multi', { widths: [700, 1000] })
  })

  it('three questions stacked', async () => {
    await show(THREE)
    await reviewUi('question three', { widths: [700, 1000], height: 1400 })
  })

  it('Other chosen, with the typed answer', async () => {
    await show(NAMES_INPUT)
    await userEvent.click(page.getByTestId('chat-question-option-3'))
    await userEvent.fill(page.getByTestId('chat-question-other'), 'Both, behind a flag, with the preferred name first')
    expect(document.querySelector('[data-testid="chat-question-other"]')).not.toBeNull()
    await reviewUi('question other', { widths: [700, 1000] })
  })
})
