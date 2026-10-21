import { describe, it, expect } from 'vitest'
import type { TranscriptMessage } from '@shared/domain/transcript'
import { BackgroundTaskTally, chatItems, describeTool, lastPrompt, latestTurn, mergeLive, runningBackgroundTasks, stillQueued, withFileDetails, withoutToolCalls } from '@shared/chatTimeline'

const msg = (uuid: string, role: 'user' | 'assistant', blocks: TranscriptMessage['blocks']): TranscriptMessage =>
  ({ uuid, role, timestampMs: null, isSidechain: false, blocks })

const startedInBackground = (id: string, task: string): TranscriptMessage[] => [
  msg(`a-${id}`, 'assistant', [{ type: 'tool_use', id, name: 'Bash', input: { command: 'sleep 9', description: `Task ${task}`, run_in_background: true } }]),
  msg(`r-${id}`, 'user', [{ type: 'tool_result', toolUseId: id, content: `Command running in background with ID: ${task}. Output is being written to: /tmp/x`, isError: false }]),
]

const finishedInBackground = (...tasks: string[]): TranscriptMessage =>
  msg(`n-${tasks.join()}`, 'user', [{ type: 'text', text: `<task-notification>\n${tasks.map((t) => `<task-id>${t}</task-id>`).join('\n')}\n<status>completed</status>\n</task-notification>` }])

const CONVERSATION: TranscriptMessage[] = [
  msg('u1', 'user', [{ type: 'text', text: 'list the files' }]),
  msg('a1', 'assistant', [{ type: 'thinking', text: '' }]),
  msg('a2', 'assistant', [{ type: 'text', text: 'Looking.' }, { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls', description: 'List files' } }]),
  msg('u2', 'user', [{ type: 'tool_result', toolUseId: 't1', content: 'a.txt\nb.txt', isError: false }]),
  msg('a3', 'assistant', [{ type: 'text', text: 'Two files.' }]),
  msg('u3', 'user', [{ type: 'text', text: '[Request interrupted by user]' }]),
]

describe('chat timeline', () => {
  it('pairs each tool call with its result, and drops the message that only carried results', () => {
    expect(chatItems(CONVERSATION).map((i) => i.kind)).toEqual(['user', 'thinking', 'text', 'tool', 'text', 'interrupted'])
    const tool = chatItems(CONVERSATION).find((i) => i.kind === 'tool')
    expect(tool).toMatchObject({ name: 'Bash', result: { content: 'a.txt\nb.txt', isError: false } })
  })

  it('shows a tool still waiting for its result as pending', () => {
    const items = chatItems(CONVERSATION.slice(0, 3))
    expect(items.find((i) => i.kind === 'tool')).toMatchObject({ result: null })
  })

  it('without tool calls, keeps what was said and drops a message that only ran or answered a tool', () => {
    const left = withoutToolCalls(CONVERSATION)
    expect(left.map((m) => m.uuid)).toEqual(['u1', 'a1', 'a2', 'a3', 'u3'])
    expect(left.find((m) => m.uuid === 'a2')!.blocks).toEqual([{ type: 'text', text: 'Looking.' }])
    // A message with no tool block is the same object, so a memoised row is not redrawn for it.
    expect(left[0]).toBe(CONVERSATION[0])
    expect(chatItems(left).map((i) => i.kind)).toEqual(['user', 'thinking', 'text', 'text', 'interrupted'])
  })

  it('keeps the latest prompt for the box at the top', () => {
    expect(lastPrompt(chatItems(CONVERSATION))).toMatchObject({ text: 'list the files' })
    expect(lastPrompt([])).toBeNull()
  })

  it('adds only the live messages the file does not have yet', () => {
    const persisted = CONVERSATION.slice(0, 2)
    const merged = mergeLive(persisted, CONVERSATION.slice(1, 4))
    expect(merged.map((m) => m.uuid)).toEqual(['u1', 'a1', 'a2', 'u2'])
    expect(mergeLive(persisted, [])).toBe(persisted)
  })

  it('never appends live messages older than the file part: a window that loaded only the newest page keeps them out', () => {
    // A long chat: its live list still holds messages from before the newest file page, which a
    // fresh window (or a trimmed one) does not hold. Appended at the end they showed below the newest.
    const at = (uuid: string, t: number): TranscriptMessage => ({ ...msg(uuid, 'assistant', [{ type: 'text', text: uuid }]), timestampMs: t })
    const persisted = [at('p300', 300), at('p301', 301), at('p302', 302)]
    const live = [at('o100', 100), at('o101', 101), at('p301', 301), at('p302', 302), at('n303', 303)]
    expect(mergeLive(persisted, live).map((m) => m.uuid)).toEqual(['p300', 'p301', 'p302', 'n303'])
    // No live message in the file part: only those no older than its newest are new.
    expect(mergeLive(persisted, [at('o100', 100), at('n304', 304)]).map((m) => m.uuid)).toEqual(['p300', 'p301', 'p302', 'n304'])
    expect(mergeLive(persisted, [at('o100', 100)])).toBe(persisted)
  })

  it('keeps a live message after the last one the file has, whatever its timestamp (a queued message claude takes in later)', () => {
    const at = (uuid: string, t: number | null): TranscriptMessage => ({ ...msg(uuid, 'user', [{ type: 'text', text: uuid }]), timestampMs: t })
    const persisted = [at('p1', 10), at('p2', 20)]
    expect(mergeLive(persisted, [at('p2', 20), at('q', 15), at('n', null)]).map((m) => m.uuid)).toEqual(['p1', 'p2', 'q', 'n'])
  })

  it('describes a call by what matters for its tool', () => {
    expect(describeTool('Bash', { command: 'ls -la', description: 'List files' })).toEqual({ title: 'List files', input: 'ls -la' })
    expect(describeTool('Read', { file_path: '/repo/src/app.ts' })).toEqual({ title: 'app.ts', input: '/repo/src/app.ts' })
    expect(describeTool('Grep', { pattern: 'TODO', path: 'src' })).toEqual({ title: 'TODO', input: 'TODO  in src' })
    expect(describeTool('Mystery', { a: 1 }).input).toBe('{\n  "a": 1\n}')
  })

  it('shows a background task reporting back as a notice, not as something you asked', () => {
    const notification = '<task-notification>\n<task-id>b1</task-id>\n<tool-use-id>t9</tool-use-id>\n<status>completed</status>\n<summary>Background command "Sleep" completed (exit code 0)</summary>\n</task-notification>'
    const items = chatItems([...CONVERSATION.slice(0, 1), msg('n1', 'user', [{ type: 'text', text: notification }])])
    expect(items.map((i) => i.kind)).toEqual(['user', 'notice'])
    expect(items[1]).toMatchObject({ text: 'Background command "Sleep" completed (exit code 0)', status: 'completed' })
    // The prompt pinned at the top stays the one you wrote.
    expect(lastPrompt(items)).toMatchObject({ text: 'list the files' })
  })

  it('shows a slash command as you typed it, and drops the caveat Claude Code adds before it', () => {
    const items = chatItems([
      msg('c0', 'user', [{ type: 'text', text: '<local-command-caveat>Caveat: the messages below…</local-command-caveat>' }]),
      msg('c1', 'user', [{ type: 'text', text: '<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args>opus</command-args>' }]),
      msg('c2', 'user', [{ type: 'text', text: '<local-command-stdout>Set model to Opus 5.5</local-command-stdout>' }]),
    ])
    expect(items).toMatchObject([{ kind: 'user', text: '/model opus' }, { kind: 'notice', text: 'Set model to Opus 5.5' }])
  })

  it('knows which background tasks are still running from the session file', () => {
    const file = [...startedInBackground('t1', 'b1'), ...startedInBackground('t2', 'b2'), ...startedInBackground('t3', 'b3'), finishedInBackground('b1')]
    expect(runningBackgroundTasks(file).map((t) => t.taskId)).toEqual(['b2', 'b3'])
    expect(runningBackgroundTasks(file)[0]).toEqual({ taskId: 'b2', description: 'Task b2', kind: 'shell', command: 'sleep 9', startedAtMs: null })
    // On resume Claude Code reports every task the previous process left behind, in one notification.
    expect(runningBackgroundTasks([...file, finishedInBackground('b2', 'b3')])).toEqual([])
    // An ordinary command is not a background task.
    expect(runningBackgroundTasks(CONVERSATION)).toEqual([])
  })

  it('drops a task Claude stopped with TaskStop or KillShell once the stop succeeds, and keeps it when the stop failed', () => {
    const stop = (id: string, name: string, input: Record<string, string>, isError: boolean): TranscriptMessage[] => [
      msg(`s-${id}`, 'assistant', [{ type: 'tool_use', id, name, input }]),
      msg(`sr-${id}`, 'user', [{ type: 'tool_result', toolUseId: id, isError,
        content: isError ? 'No task found with ID: b1' : '{"message":"Successfully stopped task: b1 (sleep 9)","task_id":"b1"}' }]),
    ]
    const file = [...startedInBackground('t1', 'b1'), ...startedInBackground('t2', 'b2')]
    expect(runningBackgroundTasks([...file, ...stop('s1', 'TaskStop', { task_id: 'b1' }, false)]).map((t) => t.taskId)).toEqual(['b2'])
    expect(runningBackgroundTasks([...file, ...stop('s1', 'TaskStop', { task_id: 'b1' }, true)]).map((t) => t.taskId)).toEqual(['b1', 'b2'])
    expect(runningBackgroundTasks([...file, ...stop('s1', 'KillShell', { shell_id: 'b2' }, false)]).map((t) => t.taskId)).toEqual(['b1'])
    // The stop call alone, before its result, does not end the task yet.
    expect(runningBackgroundTasks([...file, stop('s1', 'TaskStop', { task_id: 'b1' }, false)[0]])).toHaveLength(2)
  })

  it('counts a background agent as a task, with when it started', () => {
    const agent: TranscriptMessage[] = [
      { ...msg('ag', 'assistant', [{ type: 'tool_use', id: 'tA', name: 'Agent', input: { description: 'Camera trap migration', prompt: 'Migrate…', run_in_background: true } }]), timestampMs: 5000 },
      msg('agr', 'user', [{ type: 'tool_result', toolUseId: 'tA', isError: false,
        content: 'Async agent launched successfully.\nagentId: a4f9c2e1b (internal ID - do not mention to user.)\nThe agent is working in the background.\noutput_file: /private/tmp/claude-501/p/s/tasks/a4f9c2e1b.output' }]),
    ]
    expect(runningBackgroundTasks(agent)).toEqual([{ taskId: 'a4f9c2e1b', description: 'Camera trap migration', kind: 'agent', command: null, startedAtMs: 5000 }])
    expect(runningBackgroundTasks([...agent, finishedInBackground('a4f9c2e1b')])).toEqual([])
  })

  it("keeps a chat's own list of running tasks, with the command and start time the file knows", () => {
    const chat = [{ taskId: 'b2', description: 'Task b2', kind: 'shell' as const, command: null, startedAtMs: 9000 }]
    const file = runningBackgroundTasks([...startedInBackground('t1', 'b1'), ...startedInBackground('t2', 'b2')])
    expect(withFileDetails(chat, file)).toEqual([{ taskId: 'b2', description: 'Task b2', kind: 'shell', command: 'sleep 9', startedAtMs: 9000 }])
  })

  it('says how the latest turn ended, and the recap after it, until you send something', () => {
    const turnEnd = (uuid: string, ms: number, at: number): TranscriptMessage =>
      ({ ...msg(uuid, 'assistant', [{ type: 'turn_end', durationMs: ms }]), timestampMs: at })
    const recap = msg('rc', 'assistant', [{ type: 'recap', text: 'You were listing files.' }])
    expect(latestTurn([...CONVERSATION, turnEnd('t1', 33000, 1000), recap])).toEqual({ durationMs: 33000, endedAtMs: 1000, recap: 'You were listing files.' })
    expect(latestTurn([...CONVERSATION, turnEnd('t1', 33000, 1000)]).recap).toBeNull()
    expect(latestTurn([turnEnd('t1', 33000, 1000), msg('u9', 'user', [{ type: 'text', text: 'next' }])]).durationMs).toBeNull()
  })

  it('drops a queued message once the file has it, which it does before claude replays it', () => {
    const at = (uuid: string, text: string, timestampMs: number): TranscriptMessage =>
      ({ ...msg(uuid, 'user', [{ type: 'text', text }]), timestampMs })
    const queued = [
      { id: 'q1', text: 'and lint too', sentAt: 5000 },
      { id: 'q2', text: 'and lint too', sentAt: 6000 },
    ]
    expect(stillQueued(queued, CONVERSATION)).toBe(queued)
    // The same words sent earlier are not this message.
    expect(stillQueued(queued, [at('old', 'and lint too', 1000)])).toBe(queued)
    // One copy in the file answers one of the two sent.
    expect(stillQueued(queued, [at('f1', 'and lint too', 5200)])).toEqual([queued[1]])
    expect(stillQueued(queued, [at('f1', 'and lint too', 5200), at('f2', 'and lint too\n', 6100)])).toEqual([])
  })
})

describe('chat item times', () => {
  it('keeps the time of every user and text message, even within one minute', () => {
    const t = new Date(2026, 9, 10, 10, 29).getTime()
    const at = (m: TranscriptMessage, ms: number): TranscriptMessage => ({ ...m, timestampMs: ms })
    const items = chatItems([
      at(msg('u1', 'user', [{ type: 'text', text: 'hi' }]), t),
      at(msg('a1', 'assistant', [{ type: 'text', text: 'one' }]), t + 10_000),
      at(msg('a2', 'assistant', [{ type: 'text', text: 'two' }]), t + 20_000),
    ])
    expect(items.map((it) => ('timestampMs' in it ? it.timestampMs : undefined))).toEqual([t, t + 10_000, t + 20_000])
  })
})

describe('BackgroundTaskTally', () => {
  it('finds the same running tasks however the messages are split into batches', () => {
    const file = [...startedInBackground('t1', 'b1'), ...startedInBackground('t2', 'b2'), finishedInBackground('b1')]
    const whole = new BackgroundTaskTally()
    whole.add(file)
    const piecemeal = new BackgroundTaskTally()
    for (const m of file) piecemeal.add([m])
    expect(whole.tasks()).toMatchObject([{ taskId: 'b2', description: 'Task b2' }])
    expect(piecemeal.tasks()).toEqual(whole.tasks())
  })

  it('pairs a background call with its result when they arrive in different batches', () => {
    const [call, result] = startedInBackground('t1', 'b1')
    const tally = new BackgroundTaskTally()
    tally.add([call])
    expect(tally.tasks()).toEqual([])
    tally.add([result])
    expect(tally.tasks()).toMatchObject([{ taskId: 'b1', description: 'Task b1' }])
  })
})

describe('a peer message', () => {
  it('is its own item, not a prompt you wrote, so it is never pinned as your last message', () => {
    const peer: TranscriptMessage = { uuid: 'p1', role: 'user', timestampMs: 5, isSidechain: false, blocks: [{ type: 'peer_message', from: 'general-purpose', text: 'Report' }] }
    const items = chatItems([peer])
    expect(items).toEqual([{ kind: 'peer', key: 'p1', from: 'general-purpose', text: 'Report', timestampMs: 5 }])
    expect(lastPrompt(items)).toBeNull()
  })
})
