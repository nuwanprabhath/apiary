import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { CASE_NAMES, corpus, type CaseName, type CorpusCase } from '../fixtures/jsonlCorpus'
import { extractMeta } from '../../src/main/scanner/sessionScanner'

/**
 * Cases this reader gets wrong today, run as `it.fails`: the task named beside each turns one red
 * when it fixes it, and must then delete the line.
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

async function observe(name: CaseName): Promise<string | null> {
  const meta = await timed(() => extractMeta(cases[name].file))
  return meta.cwd
}

describe('extractMeta over the damaged-transcript corpus', () => {
  it.each(OK)('%s: does not throw, answers in time, finds the cwd', async (name) => {
    expect(await observe(name)).toBe(cases[name].cwd)
  })

  it.fails.each(KNOWN)('%s: known to fail today', async (name) => {
    expect(await observe(name)).toBe(cases[name].cwd)
  })
})
