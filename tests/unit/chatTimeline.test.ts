import { describe, it, expect } from 'vitest'
import type { TranscriptMessage } from '@shared/domain/transcript'
import { chatItems, describeTool, lastPrompt, latestTurn, mergeLive, runningBackgroundTasks, stillQueued, withoutToolCalls } from '@shared/chatTimeline'

const msg = (uuid: string, role: 'user' | 'assistant', blocks: TranscriptMessage['blocks']): TranscriptMessage =>
  ({ uuid, role, timestampMs: null, isSidechain: false, blocks })

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
    const started = (id: string, task: string): TranscriptMessage[] => [
      msg(`a-${id}`, 'assistant', [{ type: 'tool_use', id, name: 'Bash', input: { command: 'sleep 9', description: `Task ${task}`, run_in_background: true } }]),
      msg(`r-${id}`, 'user', [{ type: 'tool_result', toolUseId: id, content: `Command running in background with ID: ${task}. Output is being written to: /tmp/x`, isError: false }]),
    ]
    const done = (...tasks: string[]): TranscriptMessage =>
      msg(`n-${tasks.join()}`, 'user', [{ type: 'text', text: `<task-notification>\n${tasks.map((t) => `<task-id>${t}</task-id>`).join('\n')}\n<status>completed</status>\n</task-notification>` }])
    const file = [...started('t1', 'b1'), ...started('t2', 'b2'), ...started('t3', 'b3'), done('b1')]
    expect(runningBackgroundTasks(file)).toEqual([{ taskId: 'b2', description: 'Task b2' }, { taskId: 'b3', description: 'Task b3' }])
    // On resume Claude Code reports every task the previous process left behind, in one notification.
    expect(runningBackgroundTasks([...file, done('b2', 'b3')])).toEqual([])
    // An ordinary command is not a background task.
    expect(runningBackgroundTasks(CONVERSATION)).toEqual([])
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
