import { describe, expect, it } from 'vitest'
import { SlackTasks, type SlackTask } from '../../../src/main/slack/slackTasks'

function tasks(): { tasks: SlackTasks; saved: SlackTask[][] } {
  const saved: SlackTask[][] = []
  return { tasks: new SlackTasks([], (t) => { saved.push(t) }, () => 1_000), saved }
}

describe('SlackTasks', () => {
  it('a done task is reopened by open, keeping its thread', () => {
    const { tasks: t, saved } = tasks()
    t.open('1.1', 'first')
    t.finish('1.1')
    expect(t.get('1.1')?.state).toBe('done')
    expect(t.open('1.1', 'again')).toMatchObject({ thread: '1.1', state: 'open', text: 'first' })
    expect(saved.at(-1)?.[0]?.state).toBe('open')
  })

  it('taskOfSession finds only an open task', () => {
    const { tasks: t } = tasks()
    t.open('1.1', 'a')
    t.addSession('1.1', 's1')
    expect(t.taskOfSession('s1')?.thread).toBe('1.1')
    t.finish('1.1')
    expect(t.taskOfSession('s1')).toBeNull()
  })

  it('finish clears its sessions, residents and autoAllow', () => {
    const { tasks: t } = tasks()
    t.open('1.1', 'a')
    t.addSession('1.1', 's1')
    t.addResident('1.1', 'regent')
    t.setAutoAllow('1.1', 's1')
    t.finish('1.1')
    expect(t.get('1.1')).toMatchObject({ sessions: [], residents: [], autoAllow: [], state: 'done' })
  })
})
