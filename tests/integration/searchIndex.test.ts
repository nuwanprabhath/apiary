import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SearchIndex, toMatchQuery } from '../../src/main/search/searchIndex'
import { extractLineText } from '../../src/main/search/extractText'
import { runIndexPass } from '../../src/main/search/indexer'

let dir: string
let index: SearchIndex

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'apiary-search-'))
  index = new SearchIndex(join(dir, 'search.db'))
})
afterEach(() => {
  index.close()
  rmSync(dir, { recursive: true, force: true })
})

/** Writes a session JSONL whose messages contain the given texts. */
function makeJsonl(name: string, texts: string[]): string {
  const file = join(dir, name)
  writeFileSync(file, texts
    .map((t) => JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: t }] } }))
    .join('\n'))
  return file
}

const ids = (hits: { sessionId: string }[]): string[] => hits.map((h) => h.sessionId)

describe('toMatchQuery', () => {
  it('reduces a query to bare tokens, so FTS5 syntax characters cannot break the search box', () => {
    // Typed raw into MATCH, each of these is a syntax error rather than a search.
    expect(toMatchQuery('!1257')).toBe('"1257"*')
    expect(toMatchQuery('#2902')).toBe('"2902"*')
    expect(toMatchQuery('foo "bar')).toBe('"foo" AND "bar"*')
  })

  it('splits an identifier the way the tokeniser does, so the parts can be searched too', () => {
    expect(toMatchQuery('2260-remove-prefill')).toBe('"2260" AND "remove" AND "prefill"*')
  })

  it('is null when there is nothing to search for', () => {
    expect(toMatchQuery('')).toBeNull()
    expect(toMatchQuery('   !!!  ')).toBeNull()
  })

  it('does not make a prefix term out of one or two characters', () => {
    // A prefix term makes FTS5 walk every token in the index beginning with it, so the first
    // letter typed is the most expensive query the index can be asked. On a real library `"t"*`
    // took 7.7 seconds — synchronously, on the main process's thread, which froze typing in every
    // window until it finished. Short tokens are searched exactly instead.
    expect(toMatchQuery('t')).toBe('"t"')
    expect(toMatchQuery('te')).toBe('"te"')
    expect(toMatchQuery('tes')).toBe('"tes"*')
  })

  it('still prefixes only the last token, and only when it is long enough', () => {
    expect(toMatchQuery('a test')).toBe('"a" AND "test"*')
    expect(toMatchQuery('test a')).toBe('"test" AND "a"')
  })
})

describe('SearchIndex', () => {
  beforeEach(() => {
    index.put('s1', 'Fixed the CSV export on !1257, cherry-picked onto 2260-remove-prefill', 10, 1)
    index.put('s2', 'Investigated pipeline #2902 failing on the nightly plot-layout job', 20, 2)
  })

  // The searches this feature exists for, in the form the user actually types them.
  it('finds a session by merge-request number, with or without the punctuation', () => {
    expect(ids(index.search('!1257'))).toEqual(['s1'])
    expect(ids(index.search('1257'))).toEqual(['s1'])
  })

  it('finds a session by ticket number', () => {
    expect(ids(index.search('#2902'))).toEqual(['s2'])
  })

  it('finds a session by full branch name, and by any word in it', () => {
    expect(ids(index.search('2260-remove-prefill'))).toEqual(['s1'])
    expect(ids(index.search('prefill'))).toEqual(['s1'])
  })

  it('finds a session by a phrase half-remembered', () => {
    expect(ids(index.search('nightly plot'))).toEqual(['s2'])
  })

  it('narrows as you type rather than only matching whole words', () => {
    expect(ids(index.search('pipel'))).toEqual(['s2'])
  })

  it('requires every term, so two words do not match a session containing only one', () => {
    expect(index.search('csv pipeline')).toEqual([])
  })

  it('returns a snippet showing why it matched', () => {
    expect(index.search('csv')[0].snippet).toContain('«CSV»')
  })

  it('replaces a session rather than accumulating copies of it', () => {
    index.put('s1', 'completely different words now', 11, 3)
    expect(index.search('1257')).toEqual([])
    expect(ids(index.search('completely'))).toEqual(['s1'])
    expect(index.count()).toBe(2)
  })

  it('forgets a session that has been removed from view', () => {
    index.forget('s1')
    expect(index.search('1257')).toEqual([])
    expect(index.count()).toBe(1)
  })

  it('re-indexes only when the file has actually changed', () => {
    expect(index.needsIndexing('s1', 10, 1)).toBe(false)
    expect(index.needsIndexing('s1', 10, 99)).toBe(true)
    expect(index.needsIndexing('s1', 999, 1)).toBe(true)
    expect(index.needsIndexing('never-seen', 1, 1)).toBe(true)
  })
})

describe('extractLineText', () => {
  it('takes what was said, and the names in tool calls', () => {
    const line = JSON.stringify({
      message: {
        content: [
          { type: 'text', text: 'checking the branch' },
          { type: 'tool_use', name: 'Bash', input: { command: 'git checkout 2260-remove-prefill' } },
        ],
      },
    })
    expect(extractLineText(line)).toBe('checking the branch git checkout 2260-remove-prefill')
  })

  it('leaves out the bulk a tool returns, which is most of the bytes and none of the recall', () => {
    const line = JSON.stringify({
      message: { content: [{ type: 'tool_result', content: 'x'.repeat(50_000) }] },
    })
    expect(extractLineText(line)).toBeNull()
  })

  it('skips a half-written final line rather than throwing, since the file is still being appended to', () => {
    expect(extractLineText('{"message": {"content": [{"type": "te')).toBeNull()
    expect(extractLineText('')).toBeNull()
  })
})

describe('runIndexPass', () => {
  it('indexes sessions, then skips them while their files are unchanged', async () => {
    const file = makeJsonl('a.jsonl', ['deployed !1301 to staging'])
    const sessions = [{ sessionId: 'a', file }]

    expect(await runIndexPass(index, sessions)).toEqual({ indexed: 1, skipped: 0 })
    expect(ids(index.search('1301'))).toEqual(['a'])

    // Nothing changed, so the second pass does not open the file at all.
    expect(await runIndexPass(index, sessions)).toEqual({ indexed: 0, skipped: 1 })
  })

  it('picks up new content appended to a session', async () => {
    const file = makeJsonl('b.jsonl', ['first message'])
    const sessions = [{ sessionId: 'b', file }]
    await runIndexPass(index, sessions)
    expect(index.search('afterwards')).toEqual([])

    makeJsonl('b.jsonl', ['first message', 'something said afterwards'])
    expect(await runIndexPass(index, sessions)).toEqual({ indexed: 1, skipped: 0 })
    expect(ids(index.search('afterwards'))).toEqual(['b'])
  })

  it('drops a session whose file has gone, and carries on with the rest', async () => {
    const present = makeJsonl('c.jsonl', ['still here'])
    const result = await runIndexPass(index, [
      { sessionId: 'gone', file: join(dir, 'not-a-file.jsonl') },
      { sessionId: 'c', file: present },
    ])
    expect(result.indexed).toBe(1)
    expect(ids(index.search('still'))).toEqual(['c'])
  })

  it('can be stopped between files, so quitting does not wait for the whole queue', async () => {
    const sessions = ['d', 'e', 'f'].map((id) => ({
      sessionId: id, file: makeJsonl(`${id}.jsonl`, [`session ${id} content`]),
    }))
    let seen = 0
    const result = await runIndexPass(index, sessions, () => { seen += 1; return seen > 1 })
    expect(result.indexed).toBe(1)
  })
})

describe('notes in the index', () => {
  it('finds a session by something written in its note', () => {
    index.putNote('s1', 'Debugging the nightly pipeline, MR !1257 open against dev/1.0.12')
    expect(index.searchNotes('nightly').map((h) => h.sessionId)).toEqual(['s1'])
  })

  it('finds a note by an identifier with or without its punctuation, like everything else', () => {
    index.putNote('s1', 'MR !1257 and ticket #2902')
    expect(index.searchNotes('!1257').map((h) => h.sessionId)).toEqual(['s1'])
    expect(index.searchNotes('1257').map((h) => h.sessionId)).toEqual(['s1'])
    expect(index.searchNotes('2902').map((h) => h.sessionId)).toEqual(['s1'])
  })

  it('replaces a note rather than accumulating versions of it', () => {
    index.putNote('s1', 'chasing a flaky test')
    index.putNote('s1', 'turned out to be a clock skew')
    expect(index.searchNotes('flaky')).toEqual([])
    expect(index.searchNotes('skew').map((h) => h.sessionId)).toEqual(['s1'])
  })

  it('removes the entry when the note is cleared', () => {
    index.putNote('s1', 'temporary thought')
    index.putNote('s1', '')
    expect(index.searchNotes('temporary')).toEqual([])
    expect(index.noteCount()).toBe(0)
  })

  it('treats a whitespace-only note as no note', () => {
    index.putNote('s1', '   \n  ')
    expect(index.noteCount()).toBe(0)
  })

  it('keeps notes and transcripts apart, so either can be searched without the other', () => {
    index.put('s1', 'the transcript mentions carburettors', 10, 1)
    index.putNote('s2', 'the note mentions carburettors')

    expect(index.search('carburettors').map((h) => h.sessionId)).toEqual(['s1'])
    expect(index.searchNotes('carburettors').map((h) => h.sessionId)).toEqual(['s2'])
  })

  it('drops a session\'s note when the session is forgotten', () => {
    index.put('s1', 'body', 10, 1)
    index.putNote('s1', 'a note')
    index.forget('s1')
    expect(index.searchNotes('note')).toEqual([])
  })

  it('a note survives the transcript being re-indexed, and vice versa', () => {
    // They are separate tables precisely so one does not disturb the other: a session whose
    // transcript grows must not lose the note attached to it.
    index.putNote('s1', 'MR !1257')
    index.put('s1', 'first version', 10, 1)
    index.put('s1', 'second version', 20, 2)

    expect(index.searchNotes('1257').map((h) => h.sessionId)).toEqual(['s1'])
    expect(index.search('second').map((h) => h.sessionId)).toEqual(['s1'])
    expect(index.search('first')).toEqual([])
  })

  it('clearNotes empties the notes but leaves the transcripts indexed', () => {
    index.put('s1', 'transcript text', 10, 1)
    index.putNote('s1', 'note text')
    index.clearNotes()

    expect(index.noteCount()).toBe(0)
    expect(index.search('transcript').map((h) => h.sessionId)).toEqual(['s1'])
    // And the transcript is still considered up to date, so switching notes off does not force a
    // re-read of every session file.
    expect(index.needsIndexing('s1', 10, 1)).toBe(false)
  })
})
