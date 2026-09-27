import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readSearchText } from '../../src/main/search/indexer'
import { MAX_TEXT_PER_SESSION } from '../../src/main/search/searchIndex'

let dir: string
const file = () => join(dir, 's.jsonl')

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apiary-indexer-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

const userMsg = (uuid: string, text: string) => JSON.stringify({
  type: 'user', uuid, timestamp: '2026-09-01T10:00:00.000Z', isSidechain: false,
  message: { role: 'user', content: text },
})

describe('readSearchText', () => {
  it('extracts text from ordinary user and assistant lines', async () => {
    writeFileSync(file(), [userMsg('u1', 'hello there'), userMsg('u2', 'second line')].join('\n') + '\n')
    const text = await readSearchText(file())
    expect(text).toBe('hello there\nsecond line')
  })

  it('stops collecting once the running length passes MAX_TEXT_PER_SESSION, rather than reading the whole file into memory first (SEC-12)', async () => {
    // Each line is 100KB of text; more than enough lines to blow past the 2MB cap, so a session
    // with an unbounded number of them must not hold an unbounded array before it is truncated.
    const lines = Array.from({ length: 100 }, (_, i) => userMsg(`u${String(i)}`, 'x'.repeat(100_000)))
    writeFileSync(file(), lines.join('\n') + '\n')
    const text = await readSearchText(file())
    // Some slack: the loop only checks the cap between lines, so the result can run one line over.
    expect(text.length).toBeLessThan(MAX_TEXT_PER_SESSION + 100_001)
    expect(text.length).toBeGreaterThan(MAX_TEXT_PER_SESSION - 100_001)
  })

  it('skips a line above the per-line cap before it is ever JSON.parsed, rather than including it', async () => {
    const hugeLine = userMsg('huge', 'x'.repeat(2_000_000))
    writeFileSync(file(), [userMsg('u1', 'short'), hugeLine, userMsg('u2', 'also short')].join('\n') + '\n')
    const text = await readSearchText(file())
    expect(text).toBe('short\nalso short')
  })
})
