import { type JSX, type KeyboardEvent, useEffect, useRef, useState } from 'react'
import type { ChatDecision, ChatPermissionRequest } from '@shared/domain/chat'
import { askQuestionsOf, isAskInput, joinLabels, type AskQuestion } from '@shared/askQuestion'
import { Listbox, optionId, useListboxNav } from '../../ui/Listbox'
import { focusUnlessTyping } from '../../ui/focusUnlessTyping'

/** What a person has chosen for one question: option indexes (`options.length` is "Other…") and the typed text. */
interface Pick { chosen: number[]; other: string }

const RECOMMENDED = / \(Recommended\)$/

/** The answer text for a question, or null while it has none (nothing chosen, or "Other" left empty). */
function answerOf(q: AskQuestion, pick: Pick): string | null {
  const otherIndex = q.options.length
  const parts: string[] = []
  for (const i of [...pick.chosen].sort((a, b) => a - b)) {
    if (i === otherIndex) {
      if (pick.other.trim() !== '') parts.push(pick.other.trim())
    } else {
      parts.push(q.options[i].label)
    }
  }
  return parts.length === 0 || (pick.chosen.includes(otherIndex) && pick.other.trim() === '') ? null : joinLabels(parts)
}

function Row(
  { id, index, label, description, selected, active, multi, onPick }:
  { id: string; index: number; label: string; description: string; selected: boolean; active: boolean; multi: boolean; onPick: () => void },
): JSX.Element {
  const recommended = RECOMMENDED.test(label)
  return (
    <div
      id={id}
      role="option"
      aria-selected={selected}
      className={`chat-question-option${selected ? ' selected' : ''}${active ? ' active' : ''}`}
      data-testid={`chat-question-option-${String(index)}`}
      onClick={onPick}
    >
      <span className={`chat-question-mark ${multi ? 'check' : 'radio'}`} aria-hidden="true" />
      <span className="chat-question-text">
        <span className="chat-question-label">
          {recommended ? label.replace(RECOMMENDED, '') : label}
          {recommended && <span className="chat-question-tag">Recommended</span>}
        </span>
        {description !== '' && <span className="chat-question-description">{description}</span>}
      </span>
    </div>
  )
}

function QuestionBlock(
  { base, q, pick, onChange, listRef }:
  { base: string; q: AskQuestion; pick: Pick; onChange: (next: Pick) => void; listRef?: (el: HTMLElement | null) => void },
): JSX.Element {
  const [active, setActive] = useState(0)
  const otherIndex = q.options.length
  const count = otherIndex + 1
  const toggle = (i: number): void => {
    setActive(i)
    if (q.multiSelect) {
      onChange({ ...pick, chosen: pick.chosen.includes(i) ? pick.chosen.filter((c) => c !== i) : [...pick.chosen, i] })
    } else {
      onChange({ ...pick, chosen: [i] })
    }
  }
  const nav = useListboxNav({ count, active, setActive, onChoose: () => { toggle(active) } })
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === ' ') { e.preventDefault(); toggle(active); return }
    if (/^[1-9]$/.test(e.key) && Number(e.key) <= count) { e.preventDefault(); toggle(Number(e.key) - 1); return }
    nav.onKeyDown(e)
  }
  const otherChosen = pick.chosen.includes(otherIndex)
  const otherRef = useRef<HTMLInputElement | null>(null)
  // The person just chose "Other…" to type their own answer, so the field takes focus when it appears.
  useEffect(() => { if (otherChosen) otherRef.current?.focus() }, [otherChosen])
  return (
    <div className="chat-question" data-testid="chat-question">
      <span className="chat-question-header">{q.header}</span>
      <div className="chat-question-ask">{q.question}</div>
      <Listbox
        label={q.question}
        activeId={optionId(base, active)}
        className="chat-question-options"
        tabIndex={0}
        aria-multiselectable={q.multiSelect}
        ref={listRef}
        onKeyDown={onKeyDown}
      >
        {q.options.map((o, i) => (
          <Row key={o.label} id={optionId(base, i)} index={i} label={o.label} description={o.description}
            selected={pick.chosen.includes(i)} active={active === i} multi={q.multiSelect} onPick={() => { toggle(i) }} />
        ))}
        <Row id={optionId(base, otherIndex)} index={otherIndex} label="Other…" description=""
          selected={otherChosen} active={active === otherIndex} multi={q.multiSelect} onPick={() => { toggle(otherIndex) }} />
      </Listbox>
      {otherChosen && (
        <input
          className="chat-question-other"
          data-testid="chat-question-other"
          ref={otherRef}
          aria-label={`Your answer: ${q.header}`}
          placeholder="Type your answer"
          value={pick.other}
          onChange={(e) => { onChange({ ...pick, other: e.target.value }) }}
        />
      )}
    </div>
  )
}

/**
 * Claude's `AskUserQuestion` shown as the question it is, like the VS Code extension's picker: each
 * question with its options (radio rows, or checkboxes for multi-select) and an "Other…" row, all
 * stacked (there are at most four, and seeing them together shows what Submit will send). Submit
 * allows the call with `answers`; Skip declines. First focus follows the permission card's rule: the
 * first list takes it unless you are typing in the message box.
 */
export function QuestionCard(
  { request, onDecide }: { request: ChatPermissionRequest; onDecide: (decision: ChatDecision) => void },
): JSX.Element | null {
  const questions = isAskInput(request.input) ? askQuestionsOf(request.input) : []
  const [picks, setPicks] = useState<Pick[]>(() => questions.map(() => ({ chosen: [], other: '' })))
  const firstList = useRef<HTMLElement | null>(null)
  useEffect(() => { focusUnlessTyping(firstList.current) }, [])
  if (questions.length === 0) return null

  const answers = questions.map((q, i) => answerOf(q, picks[i]))
  const complete = answers.every((a) => a !== null)
  const submit = (): void => {
    if (!complete) return
    onDecide({ behavior: 'allow', answers: Object.fromEntries(questions.map((q, i) => [q.question, answers[i] ?? ''])) })
  }
  return (
    <div className="chat-permission"data-testid="chat-question-card" role="alert" aria-label="Claude has a question">
      {questions.map((q, i) => (
        <QuestionBlock
          key={q.question}
          base={`${request.requestId}-q${String(i)}`}
          q={q}
          pick={picks[i]}
          listRef={i === 0 ? (el) => { firstList.current = el } : undefined}
          onChange={(next) => { setPicks(picks.map((p, j) => (j === i ? next : p))) }}
        />
      ))}
      <div className="chat-permission-actions">
        <button className="btn primary small" data-testid="chat-question-submit" disabled={!complete} onClick={submit}>Submit</button>
        <button className="btn small" data-testid="chat-question-skip" onClick={() => { onDecide({ behavior: 'deny' }) }}>Skip</button>
      </div>
    </div>
  )
}
