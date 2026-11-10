import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { CASE_NAMES, corpus, type CaseName, type CorpusCase } from '../fixtures/jsonlCorpus'
import { readSearchText } from '../../src/main/search/indexer'

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

async function observe(name: CaseName): Promise<boolean> {
  const text = await timed(() => readSearchText(cases[name].file))
  return text.length > 0
}

describe('readSearchText over the damaged-transcript corpus', () => {
  it.each(OK)('%s: does not throw, answers in time, finds text only where there are messages', async (name) => {
    expect(await observe(name)).toBe(cases[name].messages > 0)
  })
})
