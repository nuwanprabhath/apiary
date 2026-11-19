import { describe, expect, it } from 'vitest'
import { commands } from '../../../src/main/desk/commands'
import { deskWorld } from './deskWorld'

describe('commands', () => {
  it('status lists open tasks, their sessions and the residents, and is not left open as a task', async () => {
    const w = await deskWorld()
    commands(w.parts)
    w.bridge.tasks.open('1.1', 'Fix the login page '.repeat(10))
    w.bridge.tasks.addSession('1.1', 's1')
    w.states.set('s1', { title: 'Login', status: 'waiting', since: Date.now() - 5 * 60_000 })
    expect(await w.say('', '/Status', 'task')).toBe(true)
    const post = w.slack.posts().at(-1)
    expect(post?.text).toContain('Fix the login page')
    expect(post?.text).not.toContain('Fix the login page '.repeat(5))
    expect(post?.text).toContain('Login: waiting for you, 5 min')
    expect(post?.text).toContain('Regent: idle')
    expect(post?.text).toContain('0 waiting for you.')
    expect(w.bridge.tasks.list().filter((t) => t.state === 'open').map((t) => t.thread)).toEqual(['1.1'])
  })

  it("stop interrupts the task's sessions and residents and keeps the task open", async () => {
    const w = await deskWorld()
    commands(w.parts)
    w.bridge.tasks.open('1.1', 'task')
    w.bridge.tasks.addSession('1.1', 's1')
    w.bridge.tasks.addResident('1.1', 'r1')
    expect(await w.say('1.1', 'Stop')).toBe(true)
    expect(w.interrupted).toEqual(['s1'])
    expect(w.stopped).toEqual(['r1'])
    expect(w.slack.posts().at(-1)?.text).toBe('Stopped. The task stays open; reply here to carry on.')
    expect(w.bridge.tasks.get('1.1')?.state).toBe('open')
  })

  it('other text is not taken', async () => {
    const w = await deskWorld()
    commands(w.parts)
    w.bridge.tasks.open('1.1', 'task')
    expect(await w.say('1.1', 'please stop by later')).toBe(false)
    expect(await w.say('', 'status of the build?', 'task')).toBe(false)
  })
})
