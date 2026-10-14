import { describe, it, expect } from 'vitest'
import { answersProblem, isAskInput, summarizeQuestions } from '@shared/askQuestion'
import { isChatDecision } from '@shared/domain/chat'
import { permissionReply } from '../../src/main/chat/protocol'

const input = {
  questions: [
    { question: 'Pick one?', header: 'One', multiSelect: false, options: [{ label: 'A', description: 'a' }, { label: 'B', description: 'b' }] },
    { question: 'Pick some?', header: 'Some', multiSelect: true, options: [{ label: 'X', description: 'x' }, { label: 'Y', description: 'y' }] },
  ],
}
const pending = { toolName: 'AskUserQuestion', input, suggestions: [] }

describe('AskUserQuestion input guard', () => {
  it('takes 1–4 questions of 2–4 options and refuses the rest', () => {
    expect(isAskInput(input)).toBe(true)
    expect(isAskInput({ questions: [] })).toBe(false)
    expect(isAskInput({ questions: Array.from({ length: 5 }, () => input.questions[0]) })).toBe(false)
    expect(isAskInput({ questions: [{ ...input.questions[0], options: [input.questions[0].options[0]] }] })).toBe(false)
    expect(isAskInput({ questions: [{ ...input.questions[0], header: 3 }] })).toBe(false)
    expect(isAskInput(null)).toBe(false)
  })
})

describe('chat decision with answers', () => {
  it('accepts string answers and refuses other shapes', () => {
    expect(isChatDecision({ behavior: 'allow', answers: { q: 'a' } })).toBe(true)
    expect(isChatDecision({ behavior: 'allow', answers: { q: 1 } })).toBe(false)
    expect(isChatDecision({ behavior: 'allow', answers: ['a'] })).toBe(false)
    expect(isChatDecision({ behavior: 'allow', answers: { q: 'x'.repeat(2001) } })).toBe(false)
    expect(isChatDecision({ behavior: 'allow', answers: Object.fromEntries([1, 2, 3, 4, 5].map((n) => [`q${String(n)}`, 'a'])) })).toBe(false)
  })
})

describe('answering AskUserQuestion', () => {
  it('sends the input plus answers', () => {
    const answers = { 'Pick one?': 'A', 'Pick some?': 'X, Y' }
    expect(permissionReply('r', { behavior: 'allow', answers }, pending).response).toMatchObject({
      response: { behavior: 'allow', updatedInput: { ...input, answers } },
    })
  })

  it('refuses an allow with no answers, an unknown question, or a question left unanswered', () => {
    expect(() => permissionReply('r', { behavior: 'allow' }, pending)).toThrow()
    expect(() => permissionReply('r', { behavior: 'allow', answers: { 'Pick one?': 'A', 'Pick some?': 'X', 'Nope?': 'z' } }, pending)).toThrow()
    expect(() => permissionReply('r', { behavior: 'allow', answers: { 'Pick one?': 'A' } }, pending)).toThrow()
    expect(answersProblem(input, { 'Pick one?': 'A', 'Pick some?': 'Y' })).toBeNull()
  })

  it('still denies, and leaves other tools alone', () => {
    expect(permissionReply('r', { behavior: 'deny' }, pending).response).toMatchObject({ response: { behavior: 'deny' } })
    expect(permissionReply('r', { behavior: 'allow' }, { toolName: 'Bash', input: { command: 'ls' }, suggestions: [] }).response)
      .toMatchObject({ response: { updatedInput: { command: 'ls' } } })
  })

  it('shows the call as Q → A in the timeline', () => {
    expect(summarizeQuestions({ ...input, answers: { 'Pick one?': 'A' } })).toBe('Q: Pick one? → A: A\nQ: Pick some?')
  })
})
