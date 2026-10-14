import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readTaskOutput, TASK_OUTPUT_LINES, TASK_OUTPUT_TAIL_BYTES } from '../../src/main/sessions/backgroundTaskOutput'
import { TranscriptService } from '../../src/main/sessions/transcriptService'
import { TranscriptReader } from '../../src/main/transcript/transcriptReader'
import { forEachMessageFrom } from '../../src/main/transcript/transcriptLines'

const SESSION = '3f2a9c1e-0000-4000-8000-000000000001'

let base: string
let tasks: string
let projects: string
let outside: string
const roots = (): { tempRoots: string[]; agentRoots: string[] } => ({ tempRoots: [join(base, 'tmp')], agentRoots: [projects] })

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'apiary-taskout-'))
  tasks = join(base, 'tmp', 'claude-501', 'proj', SESSION, 'tasks')
  projects = join(base, 'projects')
  outside = join(base, 'outside')
  for (const d of [tasks, projects, outside]) mkdirSync(d, { recursive: true })
})
afterEach(() => { rmSync(base, { recursive: true, force: true }) })

describe('reading a background task output', () => {
  it('reads the last lines of a shell task, without colour codes or carriage-return redraws', async () => {
    writeFileSync(join(tasks, 'b1.output'), 'one\n\u001b[32mgreen\u001b[0m\nprogress 10%\rprogress 100%\n\u001b]0;title\u0007done\n')
    expect(await readTaskOutput(join(tasks, 'b1.output'), SESSION, 'b1', 'shell', roots()))
      .toEqual({ available: true, lines: ['one', 'green', 'progress 100%', 'done'] })
  })

  it('reads only the tail of a long output, and at most the lines the popup shows', async () => {
    const lines = Array.from({ length: 20000 }, (_, i) => `line ${String(i)}`)
    writeFileSync(join(tasks, 'b1.output'), lines.join('\n'))
    const out = await readTaskOutput(join(tasks, 'b1.output'), SESSION, 'b1', 'shell', roots())
    expect(lines.join('\n').length).toBeGreaterThan(TASK_OUTPUT_TAIL_BYTES)
    expect(out.lines).toHaveLength(TASK_OUTPUT_LINES)
    expect(out.lines.at(-1)).toBe('line 19999')
  })

  it('says an empty file is available with no lines', async () => {
    writeFileSync(join(tasks, 'b1.output'), '')
    expect(await readTaskOutput(join(tasks, 'b1.output'), SESSION, 'b1', 'shell', roots())).toEqual({ available: true, lines: [] })
  })

  it('refuses a path outside the session task folder, another session folder, a mismatched name, and a symlink out', async () => {
    writeFileSync(join(outside, 'b1.output'), 'secret')
    expect((await readTaskOutput(join(outside, 'b1.output'), SESSION, 'b1', 'shell', roots())).available).toBe(false)
    const other = join(base, 'tmp', 'claude-501', 'proj', 'another-session', 'tasks')
    mkdirSync(other, { recursive: true })
    writeFileSync(join(other, 'b1.output'), 'theirs')
    expect((await readTaskOutput(join(other, 'b1.output'), SESSION, 'b1', 'shell', roots())).available).toBe(false)
    writeFileSync(join(tasks, 'b2.output'), 'b2')
    expect((await readTaskOutput(join(tasks, 'b2.output'), SESSION, 'b1', 'shell', roots())).available).toBe(false)
    symlinkSync(join(outside, 'b1.output'), join(tasks, 'b1.output'))
    expect((await readTaskOutput(join(tasks, 'b1.output'), SESSION, 'b1', 'shell', roots())).available).toBe(false)
    expect((await readTaskOutput(join(tasks, 'b1.output'), SESSION, 'b1', 'agent', roots())).available).toBe(false)
    expect((await readTaskOutput(join(tasks, 'missing.output'), SESSION, 'missing', 'shell', roots())).available).toBe(false)
  })

  it("summarises an agent's transcript as its latest steps, following its link into the projects folder", async () => {
    const entry = (content: unknown[]): string => JSON.stringify({ type: 'assistant', uuid: `u${String(Math.random())}`, timestamp: '2026-10-14T00:00:00Z', message: { role: 'assistant', content } })
    const transcript = join(projects, 'agent-a1.jsonl')
    writeFileSync(transcript, [
      JSON.stringify({ type: 'user', uuid: 'u0', message: { role: 'user', content: 'Migrate the camera trap module' } }),
      entry([{ type: 'text', text: 'Looking at the module.' }]),
      entry([{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls', description: 'List files' } }]),
      entry([{ type: 'tool_use', id: 't2', name: 'Read', input: { file_path: '/repo/src/camera.ts' } }]),
      entry([{ type: 'tool_use', id: 't3', name: 'Bash', input: { command: 'npm test\nnpm run lint' } }]),
      '',
    ].join('\n'))
    symlinkSync(transcript, join(tasks, 'a1.output'))
    expect(await readTaskOutput(join(tasks, 'a1.output'), SESSION, 'a1', 'agent', roots()))
      .toEqual({ available: true, lines: ['Looking at the module.', '→ Bash  List files', '→ Read  camera.ts', '→ Bash  npm test'] })
  })

  it('finds the output file from the session transcript, so the caller names only the task', async () => {
    writeFileSync(join(tasks, 'bq1.output'), 'built\n')
    const file = join(base, 'session.jsonl')
    const line = (o: unknown): string => JSON.stringify(o)
    writeFileSync(file, [
      line({ type: 'assistant', uuid: 'a1', timestamp: '2026-10-14T00:00:00Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'npm run build', run_in_background: true } }] } }),
      line({ type: 'user', uuid: 'r1', timestamp: '2026-10-14T00:00:01Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: `Command running in background with ID: bq1. Output is being written to: ${join(tasks, 'bq1.output')}. You will be notified when it completes.` }] } }),
      '',
    ].join('\n'))
    const found = { filePath: file, messageCount: null }
    const service = new TranscriptService({
      resolver: { findSession: (id) => (id === SESSION ? found : null), requireSession: () => found },
      store: { setMessageCount: () => undefined },
      reader: new TranscriptReader(),
      readFrom: forEachMessageFrom,
      taskOutputRoots: roots(),
    })
    expect(await service.backgroundTaskOutput(SESSION, 'bq1')).toEqual({ available: true, lines: ['built'] })
    expect(await service.backgroundTaskOutput(SESSION, 'nope')).toEqual({ available: false, lines: [] })
    expect(await service.backgroundTaskOutput('other', 'bq1')).toEqual({ available: false, lines: [] })
  })

  it('reads only what the transcript gained since the last look, as the popup refreshes', async () => {
    writeFileSync(join(tasks, 'bq1.output'), 'built\n')
    const file = join(base, 'session.jsonl')
    writeFileSync(file, `${JSON.stringify({ type: 'assistant', uuid: 'a1', timestamp: '2026-10-14T00:00:00Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'npm run build', run_in_background: true } }] } })}\n${JSON.stringify({ type: 'user', uuid: 'r1', timestamp: '2026-10-14T00:00:01Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: `Command running in background with ID: bq1. Output is being written to: ${join(tasks, 'bq1.output')}.` }] } })}\n`)
    const found = { filePath: file, messageCount: null }
    const offsets: number[] = []
    const service = new TranscriptService({
      resolver: { findSession: () => found, requireSession: () => found },
      store: { setMessageCount: () => undefined },
      reader: new TranscriptReader(),
      readFrom: (path, from, each) => { offsets.push(from); return forEachMessageFrom(path, from, each) },
      taskOutputRoots: roots(),
    })
    expect((await service.backgroundTaskOutput(SESSION, 'bq1')).available).toBe(true)
    expect((await service.backgroundTaskOutput(SESSION, 'bq1')).available).toBe(true)
    expect(offsets[0]).toBe(0)
    expect(offsets[1]).toBeGreaterThan(0)
  })
})
