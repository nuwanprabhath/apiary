import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TranscriptService } from '../../src/main/sessions/transcriptService'
import { forEachMessageFrom } from '../../src/main/transcript/transcriptLines'
import { TranscriptReader } from '../../src/main/transcript/transcriptReader'
import { stays } from '../fixtures/stays'

const at = '2026-09-01T10:00:00.000Z'
const jsonl = (entry: object): string => `${JSON.stringify(entry)}\n`
const userText = (uuid: string, text: string): string =>
  jsonl({ type: 'user', uuid, timestamp: at, isSidechain: false, message: { role: 'user', content: text } })
const startsTask = (id: string, task: string): string =>
  jsonl({ type: 'assistant', uuid: `a-${id}`, timestamp: at, isSidechain: false, message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: { command: 'sleep 9', description: `Task ${task}`, run_in_background: true } }] } }) +
  jsonl({ type: 'user', uuid: `r-${id}`, timestamp: at, isSidechain: false, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: `Command running in background with ID: ${task}. Output is being written to: /tmp/x`, is_error: false }] } })
const taskDone = (task: string): string =>
  jsonl({ type: 'user', uuid: `n-${task}`, timestamp: at, isSidechain: false, message: { role: 'user', content: `<task-notification>\n<task-id>${task}</task-id>\n<status>completed</status>\n</task-notification>` } })

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'apiary-tasks-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function fileWith(name: string, content: string): string {
  const path = join(dir, name)
  writeFileSync(path, content)
  return path
}

function serviceFor(files: Record<string, string>, readFrom: typeof forEachMessageFrom = forEachMessageFrom): TranscriptService {
  const paths = new Map(Object.entries(files))
  const find = (sessionId: string): { filePath: string; messageCount: null } | null => {
    const filePath = paths.get(sessionId)
    return filePath === undefined ? null : { filePath, messageCount: null }
  }
  return new TranscriptService({
    resolver: {
      findSession: find,
      requireSession: (sessionId) => {
        const session = find(sessionId)
        if (session === null) throw new Error(`Unknown session: ${sessionId}`)
        return session
      },
    },
    store: { setMessageCount: () => undefined },
    reader: new TranscriptReader(),
    readFrom,
  })
}

describe('TranscriptService.runningBackgroundTasks', () => {
  it('answers 0 for a session the store does not know, rather than failing', async () => {
    expect(await serviceFor({}).runningBackgroundTasks('nope')).toBe(0)
  })

  it('answers 0 when the session file is not on disk', async () => {
    expect(await serviceFor({ s1: join(dir, 'gone.jsonl') }).runningBackgroundTasks('s1')).toBe(0)
  })

  it('counts a task started before the last 200 messages', async () => {
    const filler = Array.from({ length: 250 }, (_, i) => userText(`m${i}`, `message ${i}`)).join('')
    const file = fileWith('s1.jsonl', startsTask('t1', 'b1') + filler)
    expect(await serviceFor({ s1: file }).runningBackgroundTasks('s1')).toBe(1)
  })

  it('reads a session file from where the last read ended, not from the start', async () => {
    const first = startsTask('t1', 'b1')
    const file = fileWith('s1.jsonl', first)
    const starts: number[] = []
    const service = serviceFor({ s1: file }, async (path, from, visit) => {
      starts.push(from)
      return forEachMessageFrom(path, from, visit)
    })
    expect(await service.runningBackgroundTasks('s1')).toBe(1)
    appendFileSync(file, startsTask('t2', 'b2'))
    expect(await service.runningBackgroundTasks('s1')).toBe(2)
    expect(starts).toEqual([0, Buffer.byteLength(first)])
  })

  it('stops counting a task once its notification has been appended', async () => {
    const file = fileWith('s1.jsonl', startsTask('t1', 'b1'))
    const service = serviceFor({ s1: file })
    expect(await service.runningBackgroundTasks('s1')).toBe(1)
    appendFileSync(file, taskDone('b1'))
    expect(await service.runningBackgroundTasks('s1')).toBe(0)
  })

  it('runs one read of a session at a time, so a second call waits for the first', async () => {
    const file = fileWith('s1.jsonl', startsTask('t1', 'b1'))
    let reads = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const service = serviceFor({ s1: file }, async (path, from, visit) => {
      reads++
      await gate
      return forEachMessageFrom(path, from, visit)
    })
    const first = service.runningBackgroundTasks('s1')
    const second = service.runningBackgroundTasks('s1')
    await vi.waitFor(() => expect(reads).toBe(1))
    await stays(() => reads === 1, 100, 'the second read to wait for the first')
    release()
    expect(await Promise.all([first, second])).toEqual([1, 1])
  })

  it('keeps a separate read position for each session', async () => {
    const one = startsTask('t1', 'b1') + startsTask('t2', 'b2')
    const two = startsTask('t3', 'b3')
    const starts: number[] = []
    const service = serviceFor({ s1: fileWith('s1.jsonl', one), s2: fileWith('s2.jsonl', two) }, async (path, from, visit) => {
      starts.push(from)
      return forEachMessageFrom(path, from, visit)
    })
    expect(await service.runningBackgroundTasks('s1')).toBe(2)
    expect(await service.runningBackgroundTasks('s2')).toBe(1)
    expect(await service.runningBackgroundTasks('s1')).toBe(2)
    expect(starts).toEqual([0, 0, Buffer.byteLength(one)])
  })

  it('starts over when the session file shrinks below the bytes already read', async () => {
    const file = fileWith('s1.jsonl', startsTask('t1', 'b1') + startsTask('t2', 'b2'))
    const service = serviceFor({ s1: file })
    expect(await service.runningBackgroundTasks('s1')).toBe(2)
    writeFileSync(file, startsTask('t3', 'b3'))
    expect(await service.runningBackgroundTasks('s1')).toBe(1)
  })

  it('forgets what a read that failed part way had counted, so the next read starts from the top', async () => {
    const file = fileWith('s1.jsonl', startsTask('t1', 'b1') + startsTask('t2', 'b2'))
    let failNext = true
    const service = serviceFor({ s1: file }, async (path, from, visit) => {
      if (!failNext) return forEachMessageFrom(path, from, visit)
      failNext = false
      await forEachMessageFrom(path, from, visit)
      throw new Error('read interrupted')
    })
    expect(await service.runningBackgroundTasks('s1')).toBe(0)
    writeFileSync(file, startsTask('t1', 'b1'))
    expect(await service.runningBackgroundTasks('s1')).toBe(1)
  })
})
