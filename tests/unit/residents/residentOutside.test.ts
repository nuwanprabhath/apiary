import { describe, expect, it, vi } from 'vitest'
import type { ResidentConfig, ResidentPermissionRequest, ResidentTurn } from '@shared/domain/residents'
import { at } from '../../contract/must'
import { FRIDAY, build, children, regent, spawned } from '../../integration/residents/support'

const vi_time = (d: Date): void => { vi.setSystemTime(d) }
const SAT =(hh: number): Date => new Date(2026, 10, 1, hh)
const desk = (over: Partial<ResidentConfig> = {}): ResidentConfig => regent({ id: 'desk', name: 'MR desk', ...over })
const written = (i: number): string[] => (children[i]?.written ?? []).map((l) => JSON.stringify(JSON.parse(l)))
const say = (i: number, line: unknown): void => { children[i]?.stdout.write(`${JSON.stringify(line)}\n`) }
const answer = (i: number, text: string): void => {
  say(i, { type: 'assistant', message: { content: [{ type: 'text', text }] } })
  say(i, { type: 'result', result: text })
}
const asking = (id: string): unknown => ({ type: 'control_request', request_id: id, request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'ls' } } })
const CYCLE = { cycle: { everyMinutes: 15, prompt: 'Run one cycle.', doing: 'Checking' } }
const running = (service: ReturnType<typeof build>['service'], id: string): boolean => service['residents'].get(id)?.chat.running === true

describe('messages from outside the popup', () => {
  it('sendFrom sends one text to claude and shows another, marked via slack', async () => {
    vi_time(FRIDAY(12))
    const { service } = build([regent()])
    service.start()
    service.sendFrom('regent', { text: '[Slack task 1] hi', shown: 'hi', via: 'slack' })
    await vi.waitFor(() => { expect(written(0)).toHaveLength(1) })
    expect(written(0)[0]).toContain('[Slack task 1] hi')
    expect(service.history('regent')).toMatchObject([{ role: 'user', text: 'hi', via: 'slack' }])
  })

  it('a note shows its label as a note and sends its text', async () => {
    vi_time(FRIDAY(12))
    const { service } = build([regent()])
    service.start()
    service.note('regent', { text: 'Session 7 finished: done', label: 'A session finished' })
    await vi.waitFor(() => { expect(written(0)).toHaveLength(1) })
    expect(written(0)[0]).toContain('Session 7 finished: done')
    expect(service.history('regent')).toMatchObject([{ role: 'user', text: 'A session finished', note: true }])
  })

  it('sendFrom starts a resident that is off duty', async () => {
    vi_time(SAT(12))
    const { service } = build([regent()])
    service.start()
    expect(spawned).toHaveLength(0)
    service.sendFrom('regent', { text: 'wake', shown: 'wake', via: 'slack' })
    await vi.waitFor(() => { expect(spawned).toHaveLength(1) })
  })

  it('sendFrom is not held back by the usage pause', async () => {
    vi_time(FRIDAY(12))
    const { service } = build([regent()], { usage: 99 })
    service.start()
    service.sendFrom('regent', { text: 'go', shown: 'go', via: 'slack' })
    await vi.waitFor(() => { expect(written(0)).toHaveLength(1) })
  })

  it('a disabled resident refuses with its name', () => {
    vi_time(FRIDAY(12))
    const { service } = build([regent({ enabled: false })])
    service.start()
    expect(() => { service.sendFrom('regent', { text: 'a', shown: 'a', via: 'slack' }) }).toThrow('Regent is not enabled')
    expect(() => { service.note('regent', { text: 'a', label: 'a' }) }).toThrow('Regent is not enabled')
  })

  it('a resident that needs setup refuses and says what is missing', () => {
    vi_time(FRIDAY(12))
    const { service } = build([desk()], { kinds: { setup: () => 'Set the GitLab project' } })
    service.start()
    expect(() => { service.sendFrom('desk', { text: 'a', shown: 'a', via: 'slack' }) }).toThrow('MR desk is not set up: Set the GitLab project')
  })
})

describe('keepAwake', () => {
  it('a held resident is not stopped after 20 idle minutes off duty, and is 20 minutes after the hold is released', async () => {
    vi_time(FRIDAY(17, 50))
    const { service } = build([regent()])
    service.start()
    await vi.advanceTimersByTimeAsync(100)
    expect(spawned).toHaveLength(1)
    const release = service.keepAwake('regent', 'Slack task')
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
    expect(at(service.list(), 0)).toMatchObject({ onDuty: false, state: 'idle' })
    expect(running(service, 'regent')).toBe(true)
    release()
    await vi.advanceTimersByTimeAsync(19 * 60 * 1000)
    expect(running(service, 'regent')).toBe(true)
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000)
    await vi.waitFor(() => { expect(running(service, 'regent')).toBe(false) })
  })

  it('apiary_status lists why it is kept awake', () => {
    vi_time(FRIDAY(12))
    const { service } = build([regent()])
    service.start()
    service.keepAwake('regent', 'Slack task 1')
    service.keepAwake('regent', 'watching session 4')
    // The tool text is what the resident's claude reads.
    const text = service['control']().statusText('regent')
    expect(text).toContain('Kept awake: Slack task 1, watching session 4.')
  })
})

describe('listeners', () => {
  it('onTurnEnded carries the final text and what started the turn', async () => {
    vi_time(FRIDAY(12))
    const { service } = build([regent()], { kinds: { cycle: { everyMinutes: 60, prompt: 'cycle', doing: 'Checking' } } })
    const heard: ResidentTurn[] = []
    service.onTurnEnded((e) => heard.push(e))
    service.start()
    await service.send('regent', 'hello')
    await vi.waitFor(() => { expect(written(0)).toHaveLength(1) })
    say(0, { type: 'assistant', message: { content: [{ type: 'text', text: 'first' }] } })
    service.sendFrom('regent', { text: 'joins', shown: 'joins', via: 'slack' })
    say(0, { type: 'result', result: 'first' })
    await vi.waitFor(() => { expect(heard).toHaveLength(1) })
    expect(heard[0]).toEqual({ residentId: 'regent', text: 'first', origin: 'user' })
    service.note('regent', { text: 'n', label: 'n' })
    await vi.waitFor(() => { expect(written(0)).toHaveLength(3) })
    answer(0, 'noted')
    await vi.waitFor(() => { expect(heard).toHaveLength(2) })
    expect(heard[1]).toMatchObject({ text: 'noted', origin: 'note' })
    await service.quickAction('regent', 'cycle')
    answer(0, 'checked')
    await vi.waitFor(() => { expect(heard).toHaveLength(3) })
    expect(heard[2]).toMatchObject({ text: 'checked', origin: 'cycle' })
  })

  it('a turn claude starts itself after a background task has the origin own', async () => {
    vi_time(FRIDAY(12))
    const { service } = build([regent()])
    const heard: ResidentTurn[] = []
    service.onTurnEnded((e) => heard.push(e))
    service.start()
    await service.send('regent', 'hi')
    await vi.waitFor(() => { expect(written(0)).toHaveLength(1) })
    answer(0, 'ok')
    await vi.waitFor(() => { expect(heard).toHaveLength(1) })
    answer(0, 'the task finished')
    await vi.waitFor(() => { expect(heard).toHaveLength(2) })
    expect(heard[1]).toEqual({ residentId: 'regent', text: 'the task finished', origin: 'own' })
  })

  it('onPermissions hears a request arrive and leave', async () => {
    vi_time(FRIDAY(12))
    const { service } = build([regent()])
    const heard: [string, ResidentPermissionRequest[]][] = []
    service.onPermissions((id, requests) => heard.push([id, requests]))
    service.start()
    await service.send('regent', 'hi')
    await vi.waitFor(() => { expect(written(0)).toHaveLength(1) })
    say(0, asking('q1'))
    await vi.waitFor(() => { expect(heard).toHaveLength(1) })
    expect(heard[0]).toMatchObject(['regent', [{ requestId: 'q1', tool: 'Bash', summary: 'Run: ls' }]])
    service.answerPermission('regent', 'q1', true)
    expect(heard).toHaveLength(2)
    expect(heard[1]).toEqual(['regent', []])
  })
})

describe('one resident asking another', () => {
  const both = (kinds: Parameters<typeof build>[1] = { kinds: CYCLE }): ReturnType<typeof build> => build([regent(), desk()], kinds)

  it('ask sends a note to the resident with that name and returns at once', async () => {
    vi_time(FRIDAY(12))
    const { service } = both()
    service.start()
    const to = service.ask('regent', 'mr DESK', 'What is open? ' + 'x'.repeat(200))
    expect(to).toEqual({ id: 'desk', name: 'MR desk' })
    const label = at(service.history('desk'), 0)
    expect(label).toMatchObject({ note: true })
    expect(label.text).toBe(`Regent asked: ${('What is open? ' + 'x'.repeat(200)).slice(0, 80)}`)
    await vi.waitFor(() => { expect(running(service, 'desk')).toBe(true) })
    expect(() => service.ask('regent', 'Regent', 'me?')).toThrow(/cannot ask itself/)
  })

  it('ask refuses an unknown name and lists the names', () => {
    vi_time(FRIDAY(12))
    const { service } = both()
    service.start()
    expect(() => service.ask('regent', 'Nobody', 'hi')).toThrow('Regent, MR desk')
    expect(service.names().map((n) => n.name)).toEqual(['Regent', 'MR desk'])
  })

  it('check runs the other resident\'s cycle off duty', async () => {
    vi_time(SAT(23))
    const { service } = both()
    service.start()
    const to = service.check('regent', 'MR desk')
    expect(to.id).toBe('desk')
    await vi.waitFor(() => { expect(running(service, 'desk')).toBe(true) })
    expect(at(service.history('desk'), 0)).toMatchObject({ role: 'user', text: 'Run one cycle.' })
  })

  it('check refuses a resident whose kind has no cycle', () => {
    vi_time(FRIDAY(12))
    const { service } = both({})
    service.start()
    expect(() => service.check('regent', 'MR desk')).toThrow('MR desk has nothing to check')
  })
})
