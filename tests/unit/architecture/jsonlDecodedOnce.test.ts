import { describe, expect, it } from 'vitest'
import { read, walk } from './allowlist'

/**
 * Prevents: a Claude Code JSONL line decoded by hand. The format is not a published interface, so
 * when it changes, each hand-written decoder fails differently and silently; `decodeEntry` in
 * `src/main/transcript/claudeEntry.ts` is the one place its fields are read. `src/main/chat/protocol.ts`
 * parses stream-json, a different format, and names its value `trimmed`, so it never matches.
 */
const DECODER = 'src/main/transcript/claudeEntry.ts'
const EXEMPT: Record<string, string> = {
  'src/main/statusBar/claudeUsage/tokens.ts': 'reads only usage counts; not yet moved to decodeEntry (outside the decoder task\'s files)',
}
const PARSES_LINE = /JSON\.parse\(\s*line\s*\)/

export function handDecoders(files: { rel: string; text: string }[]): string[] {
  return files.filter((f) => f.rel !== DECODER && !(f.rel in EXEMPT) && PARSES_LINE.test(f.text)).map((f) => f.rel)
}

describe('a JSONL line is decoded once', () => {
  it('no file under src/main but the decoder calls JSON.parse(line)', () => {
    const files = walk(['src/main'], ['.ts']).map((rel) => ({ rel, text: read(rel) }))
    const found = handDecoders(files)
    expect(found, `decode a Claude Code JSONL line with decodeEntry (src/main/transcript/claudeEntry.ts), not JSON.parse: ${found.join(', ')}`).toEqual([])
  })

  it('fires on a consumer that parses a line itself', () => {
    expect(handDecoders([{ rel: 'src/main/search/extractText.ts', text: 'const e = JSON.parse(line) as Record<string, unknown>' }]))
      .toEqual(['src/main/search/extractText.ts'])
  })

  it('every exemption names a file that still parses a line', () => {
    const stale = Object.keys(EXEMPT).filter((rel) => !PARSES_LINE.test(read(rel)))
    expect(stale).toEqual([])
  })
})
