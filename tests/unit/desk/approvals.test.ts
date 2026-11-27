import { describe, expect, it } from 'vitest'
import { approvals } from '../../../src/main/desk/approvals'
import { deskWorld } from './deskWorld'

const permission = (sessionId: string, requestId: string, toolName = 'Bash', input: unknown = { command: 'npm test' }, description = '') =>
  ({ kind: 'permission', sessionId, title: 'Fix login', request: { requestId, toolName, description, input, canAlwaysAllow: false } }) as never

async function start() {
  const w = await deskWorld()
  const stop = approvals(w.parts)
  w.bridge.tasks.open('100.1', 'fix the login')
  w.bridge.tasks.addSession('100.1', 's1')
  w.bridge.tasks.addResident('100.1', 'r1')
  const posts = (): string[] => w.slack.posts().map((p) => p.text)
  return { ...w, stop, posts }
}
const QUESTION = { questions: [
  { question: 'Which db?', header: 'DB', options: [{ label: 'pg', description: '' }, { label: 'sqlite', description: '' }] },
  { question: 'Which port?', header: 'Port', options: [{ label: '80', description: '' }, { label: '8080', description: '' }] },
] }

describe('approvals', () => {
  it("a watched session's permission request is posted to its task's thread in main's words", async () => {
    const w = await start()
    w.emit(permission('s1', 'q1', 'Bash', { command: 'npm test' }, 'Runs the tests'))
    await expect.poll(() => w.slack.posts().length).toBe(1)
    expect(w.slack.posts()[0]?.thread).toBe('100.1')
    expect(w.posts()[0]).toBe('*Fix login* wants to run: npm test.\n_Runs the tests_\nReply allow, deny, or allow all (this session, until the task is done).')
  })

  it('allow answers the oldest waiting card and reacts to the reply', async () => {
    const w = await start()
    w.emit(permission('s1', 'q1'))
    w.emit(permission('s1', 'q2'))
    expect(await w.say('100.1', 'Allow!')).toBe(true)
    expect(w.answers).toEqual([{ sessionId: 's1', requestId: 'q1', decision: { behavior: 'allow' } }])
    await expect.poll(() => w.slack.reactions().map((r) => r.name)).toEqual(['white_check_mark'])
  })

  it("a card leaves the owner's eyes alone, and the reply that answers it gets the tick", async () => {
    const w = await start()
    w.bridge.tasks.addReceipt('100.1', '100.1')
    w.emit(permission('s1', 'q1'))
    await expect.poll(() => w.slack.posts().length).toBe(1)
    expect(w.bridge.tasks.get('100.1')?.receipts).toEqual(['100.1'])
    await w.say('100.1', 'allow')
    await expect.poll(() => w.slack.reactionLog().length).toBe(2)
    const [off, on] = w.slack.reactionLog()
    const reply = on?.replace('+white_check_mark ', '')
    expect([off, on]).toEqual([`-eyes ${reply ?? ''}`, `+white_check_mark ${reply ?? ''}`])
    expect(reply).not.toBe('100.1')
    expect(w.bridge.tasks.get('100.1')?.receipts).toEqual(['100.1'])
    w.stop()
  })

  it('deny answers it with a deny', async () => {
    const w = await start()
    w.emit(permission('s1', 'q1'))
    await w.say('100.1', 'no')
    expect(w.answers[0]?.decision).toEqual({ behavior: 'deny', message: 'The user said no from Slack.' })
  })

  it('allow all allows it, every other waiting card of that session, and its later requests without a card', async () => {
    const w = await start()
    w.emit(permission('s1', 'q1'))
    w.emit(permission('s1', 'q2'))
    await w.say('100.1', 'allow all')
    expect(w.answers.map((a) => a.requestId)).toEqual(['q1', 'q2'])
    expect(w.bridge.tasks.get('100.1')?.autoAllow).toEqual(['s1'])
    await expect.poll(() => w.slack.posts().length).toBe(2)
    w.emit(permission('s1', 'q3'))
    expect(w.answers.at(-1)).toEqual({ sessionId: 's1', requestId: 'q3', decision: { behavior: 'allow' } })
    expect(w.slack.posts().length).toBe(2)
  })

  it("allow all never covers a question or a resident's card", async () => {
    const w = await start()
    w.emit(permission('s1', 'q1'))
    w.emit(permission('s1', 'qq', 'AskUserQuestion', QUESTION))
    await w.say('100.1', 'allow all')
    expect(w.answers.map((a) => a.requestId)).toEqual(['q1'])
    w.emit(permission('s1', 'q4', 'AskUserQuestion', QUESTION))
    expect(w.answers.map((a) => a.requestId)).toEqual(['q1'])
    await w.say('100.1', 'deny')
    await w.say('100.1', 'deny')
    expect(w.answers.map((a) => a.requestId)).toEqual(['q1', 'qq', 'q4'])
    w.residentRequests('r1', [{ requestId: 'x1', tool: 'm', summary: 'Approve !1' }])
    await w.say('100.1', 'allow all')
    expect(w.residentAnswers).toEqual([{ id: 'r1', requestId: 'x1', allow: true }])
    expect(w.bridge.tasks.get('100.1')?.autoAllow).toEqual(['s1'])
  })

  it("a question card's reply picks options by number and passes other text as typed", async () => {
    const w = await start()
    w.emit(permission('s1', 'qq', 'AskUserQuestion', QUESTION))
    await expect.poll(() => w.posts().length).toBe(1)
    expect(w.posts()[0]).toContain('Which db? 1. pg  2. sqlite')
    await w.say('100.1', '2\nfive thousand')
    expect(w.answers[0]?.decision).toEqual({ behavior: 'allow', answers: { 'Which db?': 'sqlite', 'Which port?': 'five thousand' } })
    w.emit(permission('s1', 'q9', 'AskUserQuestion', QUESTION))
    await w.say('100.1', '1')
    expect(w.answers[1]?.decision).toEqual({ behavior: 'allow', answers: { 'Which db?': 'pg', 'Which port?': '80' } })
  })

  it("a resident's approval card goes to the thread of the task it works for, and allow answers it", async () => {
    const w = await start()
    w.residentRequests('r1', [{ requestId: 'x1', tool: 'm', summary: 'Approve !1570: title → main at abc123' }])
    await expect.poll(() => w.posts().length).toBe(1)
    expect(w.slack.posts()[0]?.thread).toBe('100.1')
    expect(w.posts()[0]).toBe('*Regent* asks: Approve !1570: title → main at abc123\nReply allow or deny.')
    await w.say('100.1', 'yes')
    expect(w.residentAnswers).toEqual([{ id: 'r1', requestId: 'x1', allow: true }])
  })

  it('a request answered at the desk is removed and the thread is told', async () => {
    const w = await start()
    w.emit(permission('s1', 'q1'))
    w.residentRequests('r1', [{ requestId: 'x1', tool: 'm', summary: 'Approve' }])
    await expect.poll(() => w.posts().length).toBe(2)
    w.emit({ kind: 'permission-gone', sessionId: w.sid('s1'), requestId: 'q1' })
    w.residentRequests('r1', [])
    await expect.poll(() => w.posts().filter((t) => t === 'That request was answered at the desk.').length).toBe(2)
    expect(await w.say('100.1', 'allow')).toBe(false)
  })

  it('a reply that is not an answer goes on to the next handler', async () => {
    const w = await start()
    w.emit(permission('s1', 'q1'))
    expect(await w.say('100.1', 'why does it want that?')).toBe(false)
    expect(await w.say('999.9', 'allow')).toBe(false)
    expect(w.answers).toEqual([])
  })

  it('a request of a session with no open task is not posted', async () => {
    const w = await start()
    w.emit(permission('other', 'q1'))
    expect(w.slack.posts()).toEqual([])
    expect(w.answers).toEqual([])
  })

  it('a finished task ends its allow all', async () => {
    const w = await start()
    w.emit(permission('s1', 'q1'))
    await w.say('100.1', 'allow all')
    w.bridge.tasks.finish('100.1')
    w.emit(permission('s1', 'q2'))
    expect(w.answers.map((a) => a.requestId)).toEqual(['q1'])
  })
})
