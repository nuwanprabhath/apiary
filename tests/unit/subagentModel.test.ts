import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { modelFromTail, SubagentModelReader, SUBAGENT_REFRESH_MS, SUBAGENT_TAIL_BYTES } from '../../src/main/sessions/subagentModel'
import { BackgroundTaskTally } from '@shared/chatTimeline'

const FIXTURE = join(__dirname, '..', 'fixtures', 'subagent-transcript.jsonl')
const AGENT = 'a4a1baf1be02cf2de'

let base: string
let folder: string
let dir: string
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'apiary-subagent-'))
  folder = join(base, 'proj', 'sess')
  dir = join(folder, 'subagents')
  mkdirSync(dir, { recursive: true })
})
afterEach(() => { rmSync(base, { recursive: true, force: true }) })

describe('reading a subagent model', () => {
  it('takes the model and effort of the latest assistant entry of a real-shaped transcript', () => {
    copyFileSync(FIXTURE, join(dir, `agent-${AGENT}.jsonl`))
    return new SubagentModelReader().read(folder, AGENT, null).then((m) => { expect(m).toEqual({ model: 'claude-sonnet-5-5', effort: 'high' }) })
  })

  it('skips a cut first line and a half-written last one', () => {
    const tail = '{"type":"assistant","message":{"model":"claude-opus-5-5","con\n{"type":"assistant","effort":"max","message":{"model":"claude-opus-5-5"}}\n{"type":"assistant","message":{"mod'
    expect(modelFromTail(tail)).toEqual({ model: 'claude-opus-5-5', effort: 'max' })
    expect(modelFromTail('{"type":"user","message":{"role":"user"}}\n')).toBeNull()
  })

  it('falls back to the meta file alias, then to the request, before the agent has written a reply', async () => {
    const reader = new SubagentModelReader()
    expect(await reader.read(folder, AGENT, { model: 'haiku', effort: null })).toEqual({ model: 'haiku', effort: null })
    writeFileSync(join(dir, `agent-${AGENT}.meta.json`), JSON.stringify({ agentType: 'general-purpose', model: 'sonnet' }))
    expect(await reader.read(folder, AGENT, { model: 'haiku', effort: 'low' })).toEqual({ model: 'sonnet', effort: 'low' })
    expect(await reader.read(folder, AGENT, null)).toEqual({ model: 'sonnet', effort: null })
    expect(await new SubagentModelReader().read(folder, 'zzz', null)).toEqual({ model: null, effort: null })
  })

  it('refuses an agent id that is not letters and digits, and a transcript linked from outside the folder', async () => {
    writeFileSync(join(base, 'secret.jsonl'), '{"type":"assistant","effort":"high","message":{"model":"claude-opus-5-5"}}\n')
    symlinkSync(join(base, 'secret.jsonl'), join(dir, `agent-${AGENT}.jsonl`))
    const reader = new SubagentModelReader()
    expect(await reader.read(folder, AGENT, null)).toEqual({ model: null, effort: null })
    expect(await reader.read(folder, '../../secret', null)).toEqual({ model: null, effort: null })
  })

  it('reads only the tail, and again only after the refresh time and a change', async () => {
    const path = join(dir, `agent-${AGENT}.jsonl`)
    const filler = `${JSON.stringify({ type: 'user', message: { role: 'user', content: 'x'.repeat(1000) } })}\n`.repeat(Math.ceil(SUBAGENT_TAIL_BYTES / 1000) * 2)
    writeFileSync(path, `${JSON.stringify({ type: 'assistant', effort: 'low', message: { model: 'claude-haiku-4-5' } })}\n${filler}`)
    let now = 1_000
    const reader = new SubagentModelReader(() => now)
    // The only assistant entry is beyond the tail: unknown rather than a read of the whole file.
    expect(await reader.read(folder, AGENT, null)).toEqual({ model: null, effort: null })
    appendFileSync(path, `${JSON.stringify({ type: 'assistant', effort: 'high', message: { model: 'claude-sonnet-5-5' } })}\n`)
    now += 100
    expect((await reader.read(folder, AGENT, null)).model).toBeNull()
    now += SUBAGENT_REFRESH_MS
    expect(await reader.read(folder, AGENT, null)).toEqual({ model: 'claude-sonnet-5-5', effort: 'high' })
  })

  it('has the tally keep what the starting call asked for, for agents only', () => {
    const tally = new BackgroundTaskTally()
    const call = (id: string, name: string, input: object): object => ({ blocks: [{ type: 'tool_use', id, name, input: { run_in_background: true, ...input } }], timestampMs: 1 })
    const result = (id: string, content: string): object => ({ blocks: [{ type: 'tool_result', toolUseId: id, content, isError: false }], timestampMs: 2 })
    tally.add([
      call('t1', 'Agent', { description: 'lane', model: 'sonnet', effort: 'high' }), result('t1', 'Async agent launched successfully.\nagentId: a1b2c3 (x)'),
      call('t2', 'Bash', { command: 'ls', model: 'x' }), result('t2', 'Command running in background with ID: b9.'),
    ] as never)
    expect(tally.requestedModel('a1b2c3')).toEqual({ model: 'sonnet', effort: 'high' })
    expect(tally.requestedModel('b9')).toBeNull()
  })

  it('counts an agent Claude Code put in the background on its own, with no run_in_background (2.1.326)', () => {
    const tally = new BackgroundTaskTally()
    tally.add([
      { blocks: [{ type: 'tool_use', id: 't1', name: 'Agent', input: { description: 'Draft 1.0.13-RC1 changelog', subagent_type: 'general-purpose', prompt: 'x' } }], timestampMs: 1 },
      { blocks: [{ type: 'tool_result', toolUseId: 't1', content: 'Async agent launched successfully. (This tool result is internal metadata.)\nagentId: afdfe039898ba7b31 (internal ID)', isError: false }], timestampMs: 2 },
      { blocks: [{ type: 'tool_use', id: 't2', name: 'Agent', input: { description: 'inline', prompt: 'y' } }], timestampMs: 3 },
      { blocks: [{ type: 'tool_result', toolUseId: 't2', content: 'The agent finished: all done.', isError: false }], timestampMs: 4 },
    ] as never)
    expect(tally.requestedModel('afdfe039898ba7b31')).toEqual({ model: null, effort: null })
    expect(tally.tasks().map((t) => [t.taskId, t.kind, t.description])).toEqual([['afdfe039898ba7b31', 'agent', 'Draft 1.0.13-RC1 changelog']])
  })
})
