import { appendFileSync, mkdirSync, statSync, truncateSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const CASE_NAMES = [
  'plain', 'empty', 'noTrailingNewline', 'truncatedLastLine', 'notJsonLine', 'largeFirstLine',
  'hugeMiddleLine', 'invalidUtf8', 'splitMultibyte', 'crlf', 'bom', 'nulBytes', 'onlyMetadata',
  'duplicateUuids',
] as const

export type CaseName = (typeof CASE_NAMES)[number]

export interface CorpusCase {
  file: string
  /** Non-empty lines in the file, damaged ones included. */
  lines: number
  /** User and assistant lines a correct reader finds. */
  messages: number
  cwd: string | null
}

const CWD = '/work/corpus'
const base = { sessionId: 's1', cwd: CWD, gitBranch: 'main', isSidechain: false, version: '2.1.246' }
const user = (uuid: string, text: string): string => JSON.stringify({
  ...base, type: 'user', uuid, timestamp: '2026-09-01T10:00:00.000Z', message: { role: 'user', content: text },
})
const assistant = (uuid: string, text: string): string => JSON.stringify({
  ...base, type: 'assistant', uuid, timestamp: '2026-09-01T10:01:00.000Z',
  message: { role: 'assistant', content: [{ type: 'text', text }] },
})
const meta = (n: number, pad = ''): string => JSON.stringify({ type: 'queue-operation', operation: 'enqueue', n, pad })
const [u1, a1, u2] = [user('u1', 'first'), assistant('a1', 'second'), user('u2', 'third')] as [string, string, string]
const three = [u1, a1, u2]
const joined = (lines: string[], eol = '\n'): Buffer => Buffer.from(lines.join(eol) + eol)

/** A 4-byte character whose first byte sits two bytes before the 64 KB read boundary. */
function splitMultibyteLine(): string {
  const prefix = user('u1', '').slice(0, -3)
  const pad = 65536 - 2 - Buffer.byteLength(prefix)
  return `${prefix}${'a'.repeat(pad)}😀"}}`
}

/** An assistant line whose text holds two bytes that are not UTF-8. */
function invalidUtf8Line(): Buffer {
  const line = assistant('a1', 'bad ##')
  const at = Buffer.from(line).indexOf('##')
  const bytes = Buffer.from(line)
  bytes[at] = 0xff
  bytes[at + 1] = 0xfe
  return bytes
}

interface Spec { data: Buffer; lines: number; messages: number; cwd: string | null }

const CASES: Record<CaseName, Spec> = {
  plain: { data: joined(three), lines: 3, messages: 3, cwd: CWD },
  empty: { data: Buffer.alloc(0), lines: 0, messages: 0, cwd: null },
  noTrailingNewline: { data: Buffer.from(three.join('\n')), lines: 3, messages: 3, cwd: CWD },
  truncatedLastLine: { data: Buffer.from(`${u1}\n${a1}\n${u2.slice(0, 40)}`), lines: 3, messages: 2, cwd: CWD },
  notJsonLine: { data: joined([u1, 'this is not json {', a1]), lines: 3, messages: 2, cwd: CWD },
  largeFirstLine: { data: joined([meta(0, 'x'.repeat(100_000)), ...three]), lines: 4, messages: 3, cwd: CWD },
  hugeMiddleLine: { data: joined([u1, meta(1, 'x'.repeat(5_000_000)), a1]), lines: 3, messages: 2, cwd: CWD },
  invalidUtf8: { data: Buffer.concat([joined([u1]), invalidUtf8Line(), Buffer.from(`\n${u2}\n`)]), lines: 3, messages: 3, cwd: CWD },
  splitMultibyte: { data: joined([splitMultibyteLine(), a1]), lines: 2, messages: 2, cwd: CWD },
  crlf: { data: joined(three, '\r\n'), lines: 3, messages: 3, cwd: CWD },
  bom: { data: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), joined(three)]), lines: 3, messages: 3, cwd: CWD },
  nulBytes: { data: Buffer.concat([joined([u1]), Buffer.alloc(100), Buffer.from('\n'), joined([a1])]), lines: 3, messages: 2, cwd: CWD },
  onlyMetadata: {
    data: joined([JSON.stringify({ ...base, type: 'queue-operation' }), JSON.stringify({ type: 'ai-title', aiTitle: 'T' }), meta(2)]),
    lines: 3, messages: 0, cwd: CWD,
  },
  duplicateUuids: { data: joined([user('same', 'one'), assistant('same', 'two'), user('same', 'three')]), lines: 3, messages: 3, cwd: CWD },
}

/** Writes every case as `<dir>/<name>.jsonl` and says what a correct reader finds in each. */
export function corpus(dir: string): Record<CaseName, CorpusCase> {
  mkdirSync(dir, { recursive: true })
  const out = {} as Record<CaseName, CorpusCase>
  for (const name of CASE_NAMES) {
    const { data, ...expected } = CASES[name]
    const file = join(dir, `${name}.jsonl`)
    writeFileSync(file, data)
    out[name] = { file, ...expected }
  }
  return out
}

/** Cuts the file shorter, as a rewrite or rotation does. */
export function shrink(file: string): void {
  truncateSync(file, Math.floor(statSync(file).size / 2))
}

/** Appends half a line with no newline, as Claude does mid-write. */
export function appendPartial(file: string): void {
  appendFileSync(file, '{"type":"user","uuid":"p1","message":{"role":"us')
}
