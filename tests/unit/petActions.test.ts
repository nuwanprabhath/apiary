import { describe, it, expect } from 'vitest'
import { latestAction } from '@shared/pets/actions'
import type { TranscriptMessage } from '@shared/domain/transcript'

const said = (role: 'user' | 'assistant', blocks: TranscriptMessage['blocks'], isSidechain = false): TranscriptMessage => ({ uuid: String(Math.random()), role, timestampMs: 0, isSidechain, blocks })
const tool = (name: string, input: unknown): TranscriptMessage['blocks'][number] => ({ type: 'tool_use', id: 't', name, input })

describe('what a pet may be told Claude is doing', () => {
  it('names the latest tool and its label — never the command, the output or anything said', () => {
    const messages = [
      said('user', [{ type: 'text', text: 'my secret plan' }]),
      said('assistant', [{ type: 'text', text: 'I will look at the secret file' }, tool('Bash', { command: 'cat ~/.ssh/id_rsa', description: 'Run the e2e suite' })]),
      said('user', [{ type: 'tool_result', toolUseId: 't', content: 'PRIVATE OUTPUT', isError: false }]),
    ]
    expect(latestAction(messages)).toBe('Bash: Run the e2e suite')
    expect(latestAction([...messages, said('assistant', [tool('Edit', { file_path: '/home/me/src/csvWriter.ts', old_string: 'x', new_string: 'y' })])])).toBe('Edit: csvWriter.ts')
  })

  it('says only what kind of thing it is for searches, web fetches and unknown tools', () => {
    expect(latestAction([said('assistant', [tool('Grep', { pattern: 'password=.*' })])])).toBe('searching the code')
    expect(latestAction([said('assistant', [tool('WebFetch', { url: 'https://x.test/?token=abc' })])])).toBe('reading a web page')
    expect(latestAction([said('assistant', [tool('mcp__db__query', { sql: 'select *' })])])).toBe('using mcp__db__query')
  })

  it('is nothing while Claude is only writing, and ignores helpers working in the background', () => {
    expect(latestAction([said('assistant', [tool('Bash', { description: 'Old' })]), said('assistant', [{ type: 'text', text: 'Done.' }])])).toBeNull()
    expect(latestAction([said('assistant', [tool('Bash', { description: 'Mine' })]), said('assistant', [tool('Bash', { description: 'Helper' })], true)])).toBe('Bash: Mine')
  })
})
