import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { until } from './helpers'
import { ask, NAMES_INPUT, openChat, play } from './questionFixture'

const Q = NAMES_INPUT.questions[0]

const multi = {
  questions: [{
    question: 'Which checks should run?', header: 'Checks', multiSelect: true,
    options: [{ label: 'Lint', description: 'ESLint' }, { label: 'Types', description: 'tsc' }, { label: 'Tests', description: 'vitest' }],
  }],
}

describe('AskUserQuestion as a question', () => {
  it('shows the question, its options and an accent tag for Recommended, not the permission card', async () => {
    const { fake, sessionId } = await openChat()
    play(fake, sessionId, { status: 'busy', permissions: [ask(NAMES_INPUT)] })
    await expect.element(page.getByTestId('chat-question-card')).toBeVisible()
    const card = document.querySelector('[data-testid="chat-question-card"]')!
    expect(card.textContent).toContain('Common names')
    expect(card.textContent).toContain("Luaner for Eastern Quoll")
    expect(card.textContent).toContain('One row per name')
    expect(card.querySelector('.chat-question-tag')?.textContent).toBe('Recommended')
    expect(card.textContent).not.toContain('(Recommended)')
    expect(document.querySelector('[data-testid="chat-permission"]')).toBeNull()
    expect((page.getByTestId('chat-question-submit').element() as HTMLButtonElement).disabled).toBe(true)
  })

  it('picking an option and Submit allows with that label as the answer', async () => {
    const { fake, sessionId } = await openChat()
    play(fake, sessionId, { status: 'busy', permissions: [ask(NAMES_INPUT)] })
    await userEvent.click(page.getByTestId('chat-question-option-1'))
    await userEvent.click(page.getByTestId('chat-question-submit'))
    await until(() => fake.callsTo('chatRespond').length === 1)
    expect(fake.callsTo('chatRespond')).toEqual([[sessionId, 'q1', { behavior: 'allow', answers: { [Q.question]: 'One row per name' } }]])
    await expect.element(page.getByTestId('chat-question-card')).not.toBeInTheDocument()
  })

  it('a multi-select joins the chosen labels', async () => {
    const { fake, sessionId } = await openChat()
    play(fake, sessionId, { status: 'busy', permissions: [ask(multi)] })
    await userEvent.click(page.getByTestId('chat-question-option-2'))
    await userEvent.click(page.getByTestId('chat-question-option-0'))
    await userEvent.click(page.getByTestId('chat-question-submit'))
    await until(() => fake.callsTo('chatRespond').length === 1)
    expect(fake.callsTo('chatRespond')[0][2]).toEqual({ behavior: 'allow', answers: { 'Which checks should run?': 'Lint, Tests' } })
  })

  it('Other sends the typed text, and Submit waits for it', async () => {
    const { fake, sessionId } = await openChat()
    play(fake, sessionId, { status: 'busy', permissions: [ask(NAMES_INPUT)] })
    await userEvent.click(page.getByTestId('chat-question-option-3'))
    expect((page.getByTestId('chat-question-submit').element() as HTMLButtonElement).disabled).toBe(true)
    await userEvent.fill(page.getByTestId('chat-question-other'), 'Both, behind a flag')
    await userEvent.click(page.getByTestId('chat-question-submit'))
    await until(() => fake.callsTo('chatRespond').length === 1)
    expect(fake.callsTo('chatRespond')[0][2]).toEqual({ behavior: 'allow', answers: { [Q.question]: 'Both, behind a flag' } })
  })

  it('Skip declines', async () => {
    const { fake, sessionId } = await openChat()
    play(fake, sessionId, { status: 'busy', permissions: [ask(NAMES_INPUT)] })
    await userEvent.click(page.getByTestId('chat-question-skip'))
    await until(() => fake.callsTo('chatRespond').length === 1)
    expect(fake.callsTo('chatRespond')).toEqual([[sessionId, 'q1', { behavior: 'deny' }]])
  })

  it('the keys work: the number picks, arrows and Space choose, Enter on Submit sends', async () => {
    const { fake, sessionId } = await openChat()
    play(fake, sessionId, { status: 'busy', permissions: [ask(NAMES_INPUT)] })
    await expect.element(page.getByTestId('chat-question-card')).toBeVisible()
    const list = document.querySelector<HTMLElement>('.chat-question-options')!
    list.focus()
    await userEvent.keyboard('2')
    expect(page.getByTestId('chat-question-option-1').element().getAttribute('aria-selected')).toBe('true')
    await userEvent.keyboard('{ArrowUp}{Space}')
    expect(page.getByTestId('chat-question-option-0').element().getAttribute('aria-selected')).toBe('true')
    ;(page.getByTestId('chat-question-submit').element() as HTMLElement).focus()
    await userEvent.keyboard('{Enter}')
    await until(() => fake.callsTo('chatRespond').length === 1)
    expect(fake.callsTo('chatRespond')[0][2]).toEqual({ behavior: 'allow', answers: { [Q.question]: Q.options[0].label } })
  })

  it('does not take the keyboard from the message box', async () => {
    const { fake, sessionId } = await openChat()
    await userEvent.fill(page.getByTestId('composer-input'), 'meanwhile')
    const composer = page.getByTestId('composer-input').element()
    play(fake, sessionId, { status: 'busy', permissions: [ask(NAMES_INPUT)] })
    await expect.element(page.getByTestId('chat-question-card')).toBeVisible()
    expect(document.activeElement).toBe(composer)
  })

  it('a malformed input falls back to the permission card', async () => {
    const { fake, sessionId } = await openChat()
    play(fake, sessionId, { status: 'busy', permissions: [ask({ questions: [] })] })
    await expect.element(page.getByTestId('chat-permission')).toBeVisible()
    expect(document.querySelector('[data-testid="chat-question-card"]')).toBeNull()
  })
})
