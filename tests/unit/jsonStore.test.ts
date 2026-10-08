import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, chmodSync, mkdirSync } from 'node:fs'
import type * as Fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Records the order of the calls that make a write durable, while still doing them for real.
const calls = vi.hoisted(() => [] as string[])
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof Fs>()
  return {
    ...actual,
    fsyncSync: (fd: number) => { calls.push('fsync'); actual.fsyncSync(fd) },
    renameSync: (a: string, b: string) => { calls.push('rename'); actual.renameSync(a, b) },
  }
})

import { JsonStore } from '../../src/main/fs/jsonStore'

interface Doc { items: string[], note: string }

let dir: string
let file: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'apiary-jsonstore-'))
  file = join(dir, 'nested', 'doc.json')
  calls.length = 0
})
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

const seen: { raw: unknown, from: number | undefined }[] = []
function open(version = 2): JsonStore<Doc> {
  seen.length = 0
  return new JsonStore<Doc>({
    file,
    version,
    parse: (raw, from) => {
      seen.push({ raw, from })
      const r = raw as { items?: unknown, note?: unknown, title?: unknown }
      // A version-1 file called the note `title`.
      const note = from === 1 && typeof r.title === 'string' ? r.title : typeof r.note === 'string' ? r.note : ''
      return { items: Array.isArray(r.items) ? r.items.filter((i): i is string => typeof i === 'string') : [], note }
    },
    fallback: (reason) => ({ items: [], note: `fallback:${reason}` }),
  })
}

describe('JsonStore', () => {
  it('round-trips, creates the parent directory and stamps the version into the file', () => {
    const store = open()
    store.save({ items: ['a', 'b'], note: 'hi' })
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ version: 2, items: ['a', 'b'], note: 'hi' })
    expect(open().load()).toEqual({ items: ['a', 'b'], note: 'hi' })
    expect(seen[0].from).toBe(2)
  })

  it('leaves no temp file behind, and fsyncs the temp file before renaming it into place', () => {
    open().save({ items: [], note: 'x' })
    expect(readdirSync(join(dir, 'nested'))).toEqual(['doc.json'])
    expect(calls).toEqual(['fsync', 'rename'])
  })

  it('keeps the previous file when the write cannot complete', () => {
    const store = open()
    store.save({ items: ['keep'], note: 'old' })
    chmodSync(join(dir, 'nested'), 0o500)
    try {
      expect(() => { store.save({ items: ['lost'], note: 'new' }) }).toThrow()
    } finally {
      chmodSync(join(dir, 'nested'), 0o700)
    }
    expect(open().load().items).toEqual(['keep'])
    expect(readdirSync(join(dir, 'nested'))).toEqual(['doc.json'])
  })

  it('gives the fallback for a missing file, saying so', () => {
    expect(open().load()).toEqual({ items: [], note: 'fallback:missing' })
  })

  it('gives the fallback for a corrupt file, saying so, and does not touch it', () => {
    mkdirSync(join(dir, 'nested'))
    writeFileSync(file, '{ not json')
    expect(open().load()).toEqual({ items: [], note: 'fallback:unreadable' })
    expect(readFileSync(file, 'utf8')).toBe('{ not json')
  })

  it('treats a parse that throws as an unreadable file', () => {
    mkdirSync(join(dir, 'nested'))
    writeFileSync(file, 'null')
    const store = new JsonStore<Doc>({
      file, version: 1,
      parse: (raw) => ({ items: [], note: (raw as { note: string }).note }),
      fallback: (reason) => ({ items: [], note: reason }),
    })
    expect(store.load().note).toBe('unreadable')
  })

  it('hands an older file to parse with the version it was written at, to migrate', () => {
    mkdirSync(join(dir, 'nested'))
    writeFileSync(file, JSON.stringify({ version: 1, title: 'from v1' }))
    expect(open(2).load()).toEqual({ items: [], note: 'from v1' })
    expect(seen[0].from).toBe(1)
  })

  it('hands a file with no version to parse as undefined (written before versions existed)', () => {
    mkdirSync(join(dir, 'nested'))
    writeFileSync(file, JSON.stringify({ items: ['x'], note: 'n' }))
    expect(open().load().items).toEqual(['x'])
    expect(seen[0].from).toBeUndefined()
  })

  it('reads and writes the version under a custom key', () => {
    mkdirSync(join(dir, 'nested'))
    writeFileSync(file, JSON.stringify({ schemaVersion: 1, note: 'n' }))
    const store = new JsonStore<Doc>({
      file, version: 3, versionKey: 'schemaVersion',
      parse: (raw, from) => ({ items: [], note: `v${String(from)}:${(raw as { note: string }).note}` }),
      fallback: () => ({ items: [], note: '' }),
    })
    expect(store.load().note).toBe('v1:n')
    store.save({ items: [], note: 'n' })
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ schemaVersion: 3, items: [], note: 'n' })
  })

  describe('a file from a newer version than the code knows', () => {
    const newer = { version: 5, items: ['from the future'], note: 'n', extra: { field: 'only v5 understands' } }
    const backup = () => `${file}.v5.bak`
    beforeEach(() => {
      mkdirSync(join(dir, 'nested'))
      writeFileSync(file, JSON.stringify(newer))
    })

    it('is still read, best effort, with its version passed to parse', () => {
      expect(open(2).load().items).toEqual(['from the future'])
      expect(seen[0].from).toBe(5)
    })

    it('is copied to <file>.v<N>.bak before the first write replaces it, so nothing is lost', () => {
      const store = open(2)
      store.load()
      store.save({ items: [], note: 'less data' })
      expect(JSON.parse(readFileSync(backup(), 'utf8'))).toEqual(newer)
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ version: 2, items: [], note: 'less data' })
    })

    it('keeps an existing backup of that version rather than overwriting it, and backs up once per store', () => {
      writeFileSync(backup(), 'the first backup')
      const store = open(2)
      store.save({ items: [], note: 'one' })
      store.save({ items: [], note: 'two' })
      expect(readFileSync(backup(), 'utf8')).toBe('the first backup')
      expect(readdirSync(join(dir, 'nested')).sort()).toEqual(['doc.json', 'doc.json.v5.bak'])
    })

    it('does not write anything if the backup cannot be made', () => {
      const store = open(2)
      chmodSync(join(dir, 'nested'), 0o500) // the copy fails with EACCES, not EEXIST
      try {
        expect(() => { store.save({ items: [], note: 'x' }) }).toThrow()
      } finally {
        chmodSync(join(dir, 'nested'), 0o700)
      }
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(newer)
    })

    it('makes no backup for a file at the same or an older version', () => {
      writeFileSync(file, JSON.stringify({ version: 2, items: [], note: '' }))
      open(2).save({ items: [], note: 'x' })
      writeFileSync(file, JSON.stringify({ version: 1, title: 't' }))
      open(2).save({ items: [], note: 'y' })
      expect(readdirSync(join(dir, 'nested'))).toEqual(['doc.json'])
    })
  })
})
