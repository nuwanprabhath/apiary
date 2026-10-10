import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { forEachMessageFrom } from '../../src/main/transcript/transcriptLines'

const userLine = (uuid: string, text: string): string =>
  `${JSON.stringify({ type: 'user', uuid, timestamp: '2026-09-01T10:00:00.000Z', isSidechain: false, message: { role: 'user', content: text } })}\n`

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'apiary-lines-'))
  file = join(dir, 'session.jsonl')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

async function visitFrom(start: number): Promise<{ uuids: string[]; end: number }> {
  const uuids: string[] = []
  const end = await forEachMessageFrom(file, start, (m) => { uuids.push(m.uuid) })
  return { uuids, end }
}

describe('forEachMessageFrom', () => {
  it('visits every message from the start and returns the byte offset after the last line', async () => {
    const content = userLine('u1', 'one') + userLine('u2', 'two')
    writeFileSync(file, content)
    const { uuids, end } = await visitFrom(0)
    expect(uuids).toEqual(['u1', 'u2'])
    expect(end).toBe(Buffer.byteLength(content))
  })

  it('starts from the offset it is given, so a message before it is not visited', async () => {
    const first = userLine('u1', 'one')
    writeFileSync(file, first + userLine('u2', 'two'))
    const { uuids } = await visitFrom(Buffer.byteLength(first))
    expect(uuids).toEqual(['u2'])
  })

  it('stops before a partial last line, and picks it up once it is complete', async () => {
    const complete = userLine('u1', 'one')
    writeFileSync(file, complete + userLine('u2', 'two').slice(0, -1))
    const first = await visitFrom(0)
    expect(first.uuids).toEqual(['u1'])
    expect(first.end).toBe(Buffer.byteLength(complete))
    appendFileSync(file, '\n')
    expect((await visitFrom(first.end)).uuids).toEqual(['u2'])
  })

  it('counts bytes, not characters, when a line holds multibyte text', async () => {
    const first = userLine('u1', 'café ✓ 🙂')
    writeFileSync(file, first + userLine('u2', 'after'))
    expect(Buffer.byteLength(first)).toBeGreaterThan(first.length)
    expect((await visitFrom(Buffer.byteLength(first))).uuids).toEqual(['u2'])
  })

  it('skips a line that is not a message and keeps going', async () => {
    const summary = `${JSON.stringify({ type: 'summary', summary: 'Earlier work', leafUuid: 'l1' })}\n`
    const content = summary + userLine('u1', 'one')
    writeFileSync(file, content)
    const { uuids, end } = await visitFrom(0)
    expect(uuids).toEqual(['u1'])
    expect(end).toBe(Buffer.byteLength(content))
  })

  it('skips a line over the size cap and keeps going', async () => {
    const content = userLine('big', 'x'.repeat(3_100_000)) + userLine('after', 'after')
    writeFileSync(file, content)
    const { uuids, end } = await visitFrom(0)
    expect(uuids).toEqual(['after'])
    expect(end).toBe(Buffer.byteLength(content))
  })
})
