import { describe, it, expect } from 'vitest'
import type { TranscriptMessage } from '../../src/shared/domain/transcript'
import { chatItems, describeTool, lastPrompt, mergeLive } from '../../src/shared/chatTimeline'

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
})
