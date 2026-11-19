import { ASK_USER_QUESTION, askQuestionsOf, isAskInput, type AskQuestion } from '@shared/askQuestion'
import type { ChatDecision, ChatPermissionRequest } from '@shared/domain/chat'
import { asSessionId } from '@shared/domain/ids'
import type { ResidentPermissionRequest } from '@shared/domain/residents'
import { ignoreErrorsAsync } from '@shared/ignoreErrors'
import { permissionSummary } from '../residents/activity'
import type { SlackBridge, SlackInbound } from '../slack/slackBridge'
import type { DeskParts, DeskPiece } from './deskPiece'

/** A permission request posted to a thread and not yet answered. */
interface Card {
  thread: string
  who: { kind: 'session' | 'resident'; id: string }
  requestId: string
  questions: AskQuestion[] | null
}

const DENY_SESSION: ChatDecision = { behavior: 'deny', message: 'The user said no from Slack.' }
const YES = new Set(['allow', 'yes', 'ok', 'y'])
const NO = new Set(['deny', 'no', 'n'])
const ALL = 'allow all'
const GONE = 'That request was answered at the desk.'

/** The cards waiting, by bridge, so the status command can count them. In memory only. */
const waitingByBridge = new WeakMap<SlackBridge, Card[]>()

/** How many requests wait for the owner's answer. */
export function cardsWaiting(bridge: SlackBridge): number {
  return waitingByBridge.get(bridge)?.length ?? 0
}

const normalise = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim()

function sessionCard(title: string, request: ChatPermissionRequest, questions: AskQuestion[] | null): string {
  if (questions !== null) {
    const lines = questions.map((q) => `${q.question} ${q.options.map((o, i) => `${String(i + 1)}. ${o.label}`).join('  ')}`)
    return [`*${title}* asks:`, ...lines, 'Reply with a number or your own words, one line per question.'].join('\n')
  }
  const summary = permissionSummary(request.toolName, request.input)
  const lines = [`*${title}* wants to ${summary.charAt(0).toLowerCase()}${summary.slice(1)}.`]
  if (request.description.trim() !== '') lines.push(`_${request.description.trim()}_`)
  lines.push('Reply allow, deny, or allow all (this session, until the task is done).')
  return lines.join('\n')
}

function answersOf(questions: AskQuestion[], text: string): Record<string, string> {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l !== '')
  const answers: Record<string, string> = {}
  questions.forEach((q, i) => {
    const line = lines[i] ?? lines.at(-1) ?? ''
    const option = /^\d+$/.test(line) ? q.options[Number(line) - 1] : undefined
    answers[q.question] = option?.label ?? line
  })
  return answers
}

/**
 * Relays sessions' permission prompts and questions, and residents' approval requests, to the
 * thread of the task they belong to, and takes the owner's typed reply. Cards are worded here,
 * never by an agent.
 */
export const approvals: DeskPiece = ({ bridge, driver, residents }: DeskParts) => {
  const waiting: Card[] = []
  waitingByBridge.set(bridge, waiting)

  const tell = (thread: string, text: string): void => {
    void ignoreErrorsAsync(() => bridge.post(thread, text), 'a notice is a courtesy; the card still stands')
  }
  const remove = (card: Card): void => { waiting.splice(waiting.indexOf(card), 1) }
  const answerSession = (card: Card, decision: ChatDecision): void => {
    remove(card)
    driver.answer(asSessionId(card.who.id), card.requestId, decision)
  }
  const answerResident = (card: Card, allow: boolean): void => {
    remove(card)
    residents.answerPermission(card.who.id, card.requestId, allow)
  }
  const post = (card: Card, text: string): void => {
    waiting.push(card)
    bridge.post(card.thread, text).catch(() => { const i = waiting.indexOf(card); if (i >= 0) waiting.splice(i, 1) })
  }

  const stopDriver = driver.onEvent((event) => {
    if (event.kind === 'permission-gone') {
      const card = waiting.find((c) => c.who.id === event.sessionId && c.requestId === event.requestId)
      if (card === undefined) return
      remove(card)
      tell(card.thread, GONE)
      return
    }
    if (event.kind !== 'permission') return
    const task = bridge.tasks.taskOfSession(event.sessionId)
    if (task === null) return
    const { request } = event
    const isQuestion = request.toolName === ASK_USER_QUESTION
    if (!isQuestion && task.autoAllow.includes(event.sessionId)) {
      driver.answer(event.sessionId, request.requestId, { behavior: 'allow' })
      return
    }
    const questions = isQuestion && isAskInput(request.input) ? askQuestionsOf(request.input) : null
    post(
      { thread: task.thread, who: { kind: 'session', id: event.sessionId }, requestId: request.requestId, questions },
      sessionCard(event.title, request, questions),
    )
  })

  const seenResident = new Map<string, Set<string>>()
  const stopResidents = residents.onPermissions((residentId: string, requests: ResidentPermissionRequest[]) => {
    const before = seenResident.get(residentId) ?? new Set<string>()
    const now = new Set(requests.map((r) => r.requestId))
    seenResident.set(residentId, now)
    for (const card of waiting.filter((c) => c.who.kind === 'resident' && c.who.id === residentId && !now.has(c.requestId))) {
      remove(card)
      tell(card.thread, GONE)
    }
    const task = bridge.tasks.taskOfResident(residentId)
    if (task === null) return
    const name = residents.names().find((n) => n.id === residentId)?.name ?? 'A resident'
    for (const r of requests) {
      if (before.has(r.requestId)) continue
      post(
        { thread: task.thread, who: { kind: 'resident', id: residentId }, requestId: r.requestId, questions: null },
        `*${name}* asks: ${r.summary}\nReply allow or deny.`,
      )
    }
  })

  const reply = (m: SlackInbound): boolean => {
    if (m.kind !== 'reply') return false
    const card = waiting.find((c) => c.thread === m.thread)
    if (card === undefined) return false
    const said = normalise(m.text)
    const wantsNo = NO.has(said)
    const wantsYes = YES.has(said) || said === ALL
    if (card.questions === null ? !wantsNo && !wantsYes : said === '') return false

    if (card.who.kind === 'resident') answerResident(card, wantsYes)
    else if (wantsNo) answerSession(card, DENY_SESSION)
    else if (card.questions !== null) answerSession(card, { behavior: 'allow', answers: answersOf(card.questions, m.text) })
    else {
      answerSession(card, { behavior: 'allow' })
      if (said === ALL) {
        bridge.tasks.setAutoAllow(card.thread, card.who.id)
        const same = waiting.filter((c) => c.thread === card.thread && c.who.kind === 'session' && c.who.id === card.who.id && c.questions === null)
        for (const other of same) answerSession(other, { behavior: 'allow' })
      }
    }
    void bridge.react(m.ts, 'white_check_mark')
    return true
  }
  const stopHandler = bridge.handle(20, reply)

  return () => {
    stopHandler()
    stopResidents()
    stopDriver()
    waiting.length = 0
    waitingByBridge.delete(bridge)
  }
}
