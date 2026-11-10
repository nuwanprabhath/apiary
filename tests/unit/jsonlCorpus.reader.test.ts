import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { CASE_NAMES, corpus, type CaseName, type CorpusCase } from '../fixtures/jsonlCorpus'
import { TranscriptReader } from '../../src/main/transcript/transcriptReader'

/**
 * Cases this reader gets wrong today, run as `it.fails`: the task named beside each turns one red
 * when it fixes it, and must then delete the line.
 * - bom: no task owns it yet: the first line fails to parse with the BOM in front
 */
const KNOWN: CaseName[] = []
const OK = CASE_NAMES.filter((n) => !KNOWN.includes(n))

let cases: Record<CaseName, CorpusCase>
beforeAll(() => { cases = corpus(mkdtempSync(join(tmpdir(), 'apiary-corpus-'))) })

async function timed<T>(run: () => Promise<T>): Promise<T> {
  const t0 = Date.now()
  const result = await run()
  if (Date.now() - t0 >= 2000) throw new Error('took 2 s or more')
  return result
}

async function observe(name: CaseName): Promise<number> {
  const page = await timed(() => new TranscriptReader().readTranscriptPage(cases[name].file, { limit: 100 }))
  return page.messages.length
}

describe('readTranscriptPage over the damaged-transcript corpus', () => {
  it.each(OK)('%s: does not throw, answers in time, counts the messages', async (name) => {
    expect(await observe(name)).toBe(cases[name].messages)
  })

  it.fails.each(KNOWN)('%s: known to fail today', async (name) => {
    expect(await observe(name)).toBe(cases[name].messages)
  })
})
