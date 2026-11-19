import { describe, expect, it, vi } from 'vitest'
import { asSessionId } from '@shared/domain/ids'
import type { DeskControls } from '../../../src/main/residents/mcp/deskControl'
import type { ResidentSpace } from '../../../src/main/residents/residentSpace'
import { toolsFor } from '../../../src/main/residents/mcp/tools'
import type { ToolDeps } from '../../../src/main/residents/mcp/toolKit'

const TASK = '1700000000.123456'
const SID = '11111111-1111-4111-8111-111111111111'

function controls() {
  const drive = {
    folders: vi.fn(() => [
      { id: 'abc123abc123', name: 'paratoo', branch: 'main', isRepo: true, worktreeOf: null },
      { id: 'def456def456', name: 'fix-login', branch: 'fix/login', isRepo: true, worktreeOf: 'paratoo' },
    ]),
    send: vi.fn(async () => 'sent' as const),
    start: vi.fn(async () => ({ sessionId: asSessionId(SID), folderName: 'paratoo' })),
    interrupt: vi.fn(), watch: vi.fn(), unwatch: vi.fn(), watching: vi.fn(() => ['one']),
  }
  const slack = { post: vi.fn(async () => {}), finish: vi.fn(async () => {}), openTasks: vi.fn(() => ['t']), addResident: vi.fn() }
  return { drive, slack, desk: { drive, slack } satisfies DeskControls }
}

function deps(desk: DeskControls | null): ToolDeps {
  return {
    knowledge: null,
    session: (id) => (id === SID ? { title: 'Spec failures' } : null),
    openSession: () => {}, openTabs: () => [], focusedWindow: () => null,
    residents: {
      statusText: () => '', setAttention: () => {}, setActivity: () => {},
      names: () => [{ id: 'mr', name: 'MR desk', kindId: 'mr-desk', state: 'idle', setupNeeded: null }],
      ask: () => ({ id: 'mr', name: 'MR desk' }), check: () => ({ id: 'mr', name: 'MR desk' }),
    },
    desk: () => desk,
  }
}

const ALL = toolsFor(['sessions.drive', 'residents.delegate', 'slack.post'])
async function call(name: string, args: unknown, d: ToolDeps) {
  const t = ALL.find((x) => x.name === name)
  if (t === undefined) throw new Error(`no tool ${name}`)
  return t.call(args, { residentId: 'regent', space: {} as ResidentSpace }, d)
}

describe('desk tools', () => {
  it('with no desk set every desk tool answers that Slack is not connected', async () => {
    expect(ALL.length).toBe(12)
    for (const t of ALL) {
      const r = await t.call({ sessionId: SID, text: 'x', taskId: TASK, folderId: 'f', name: 'MR desk', summary: 's' }, { residentId: 'r', space: {} as ResidentSpace }, deps(null))
      expect(r).toEqual({ text: 'Slack is not connected on this machine.', isError: true })
    }
  })

  it('send_to_session refuses an unknown session and an empty text', async () => {
    const c = controls()
    expect((await call('send_to_session', { sessionId: 'nope', text: 'hi' }, deps(c.desk))).isError).toBe(true)
    expect((await call('send_to_session', { sessionId: SID, text: '  ' }, deps(c.desk))).isError).toBe(true)
    expect(c.drive.send).not.toHaveBeenCalled()
    const r = await call('send_to_session', { sessionId: SID, text: 'go', taskId: TASK }, deps(c.desk))
    expect(r).toEqual({ text: 'Sent to Spec failures.', isError: false })
    expect(c.drive.send).toHaveBeenCalledWith(SID, 'go', TASK)
  })

  it('start_session maps newBranch to a new branch request', async () => {
    const c = controls()
    const w = { name: 'fix-login-spec', branch: 'fix/login-spec', newBranch: true, from: 'main' }
    const r = await call('start_session', { folderId: 'abc123abc123', text: 'fix it', worktree: w, taskId: TASK }, deps(c.desk))
    expect(r.text).toBe(`Started a new session in paratoo (id: ${SID}).`)
    expect(c.drive.start).toHaveBeenCalledWith('abc123abc123', 'fix it', { name: 'fix-login-spec', branch: { kind: 'new', branch: 'fix/login-spec', from: 'main' } }, TASK)
    await call('start_session', { folderId: 'abc123abc123', text: 'x', worktree: { ...w, newBranch: false } }, deps(c.desk))
    expect(c.drive.start).toHaveBeenLastCalledWith('abc123abc123', 'x', { name: 'fix-login-spec', branch: { kind: 'local', branch: 'fix/login-spec' } }, null)
  })

  it('ask_resident with a task id adds the other resident to the task', async () => {
    const c = controls()
    const r = await call('ask_resident', { name: 'MR desk', text: 'check my MRs', taskId: TASK }, deps(c.desk))
    expect(r.isError).toBe(false)
    expect(c.slack.addResident).toHaveBeenCalledWith(TASK, 'mr')
    await call('run_resident_check', { name: 'MR desk' }, deps(c.desk))
    expect(c.slack.addResident).toHaveBeenCalledTimes(1)
  })

  it('a task id that is not a Slack ts is refused', async () => {
    const c = controls()
    for (const taskId of ['abc', '12.3', '1700000000.123456; rm', 5]) {
      expect((await call('slack_post', { taskId, text: 'hi' }, deps(c.desk))).isError).toBe(true)
    }
    expect((await call('send_to_session', { sessionId: SID, text: 'hi', taskId: 'bad' }, deps(c.desk))).isError).toBe(true)
    expect(c.slack.post).not.toHaveBeenCalled()
  })

  it('list_folders never prints a path', async () => {
    const r = await call('list_folders', {}, deps(controls().desk))
    expect(r.text).toBe('- paratoo (id: abc123abc123) · main\n- fix-login (id: def456def456) · fix/login · worktree of paratoo')
  })
})
