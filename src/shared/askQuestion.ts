import { isRecord } from './guards'

/**
 * Claude's `AskUserQuestion` tool: its input, and the `answers` a person's reply adds to it.
 * Claude Code takes the answer as an allow whose `updatedInput` is the input plus
 * `answers: { [question text]: label }` (multi-select labels joined with ", "; "Other" is the typed
 * text), which is what the VS Code extension sends.
 */

export const ASK_USER_QUESTION = 'AskUserQuestion'
const MAX_QUESTIONS = 4

export interface AskOption { label: string; description: string }
export interface AskQuestion { question: string; header: string; options: AskOption[]; multiSelect: boolean }
export interface AskInput { questions: unknown[] }

function isOption(value: unknown): boolean {
  return isRecord(value) && typeof value.label === 'string' && value.label !== ''
    && (value.description === undefined || typeof value.description === 'string')
}

function isQuestion(value: unknown): boolean {
  return isRecord(value) && typeof value.question === 'string' && value.question !== ''
    && typeof value.header === 'string'
    && Array.isArray(value.options) && value.options.length >= 2 && value.options.length <= 4
    && value.options.every(isOption)
    && (value.multiSelect === undefined || typeof value.multiSelect === 'boolean')
}

/** The input of an AskUserQuestion call when it has the shape the card needs (1–4 questions of 2–4 options). */
export function isAskInput(value: unknown): value is AskInput {
  return isRecord(value) && Array.isArray(value.questions)
    && value.questions.length >= 1 && value.questions.length <= MAX_QUESTIONS
    && value.questions.every(isQuestion)
}

/** The questions of a valid input, with every optional field filled in. */
export function askQuestionsOf(input: AskInput): AskQuestion[] {
  return (input.questions as Record<string, unknown>[]).map((q) => ({
    question: q.question as string,
    header: q.header as string,
    multiSelect: q.multiSelect === true,
    options: (q.options as Record<string, unknown>[]).map((o) => ({
      label: o.label as string,
      description: typeof o.description === 'string' ? o.description : '',
    })),
  }))
}

/** How a multi-select answer joins its labels. */
const JOIN = ', '

/**
 * Why `answers` cannot go back to Claude for `input`, or null when they can. Every question needs a
 * non-empty answer and every key must be one of the asked questions. The value may be an option's
 * label or the free text of "Other"; the two cannot be told apart over IPC, so it is bounded
 * (`isChatDecision`) but not matched to labels.
 */
export function answersProblem(input: unknown, answers: Record<string, string> | undefined): string | null {
  if (!isAskInput(input)) return 'The question is not in the shape Claude sent'
  if (answers === undefined) return 'A question needs an answer'
  const questions = askQuestionsOf(input)
  for (const key of Object.keys(answers)) {
    if (!questions.some((q) => q.question === key)) return 'That answer is for a question Claude did not ask'
  }
  for (const q of questions) {
    const a = answers[q.question]
    if (a === undefined || a.trim() === '') return 'A question needs an answer'
  }
  return null
}

/** The chosen labels of a multi-select answer, joined as Claude Code expects. */
export function joinLabels(labels: string[]): string {
  return labels.join(JOIN)
}

/** "Q: … → A: …" lines for the timeline; the input carries `answers` once the call was answered. */
export function summarizeQuestions(input: unknown): string | null {
  if (!isAskInput(input)) return null
  const answers = (input as { answers?: unknown }).answers
  const given = isRecord(answers) ? answers : {}
  return askQuestionsOf(input).map((q) => {
    const a = given[q.question]
    return typeof a === 'string' ? `Q: ${q.question} → A: ${a}` : `Q: ${q.question}`
  }).join('\n')
}
