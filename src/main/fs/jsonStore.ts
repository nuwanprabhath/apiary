import { copyFileSync, constants, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { isFiniteNumber, isRecord } from '@shared/guards'
import { writeJsonAtomic } from './atomicWrite'

/**
 * `JsonStore<T>`: the one way Apiary persists JSON state it reads back on its own (settings, the
 * window layout, themes, pets). A store is a file path, the version of the shape the code writes,
 * a `parse` that turns whatever is on disk into a valid `T`, and a `fallback` for when there is
 * nothing usable.
 *
 * **Reading (`load`).** Never throws. A missing file gives `fallback('missing')`; one that cannot
 * be read, is not JSON, or makes `parse` throw gives `fallback('unreadable')` — the reason lets a
 * store treat "first run" differently from "damaged" (themes do). Otherwise `parse(raw, fromVersion)`
 * is called with the decoded JSON (anything: a hand-edited file can hold any value) and the
 * version recorded in it (`undefined` for a file written before versions existed, or one that has
 * no number there). `parse` is where migration and validation live; it should be total and return
 * a `T` whatever it is given. A damaged file is left alone on disk until the next `save`.
 *
 * **Writing (`save`).** Creates the parent directory, stamps the current `version` into the object
 * under `versionKey` (default `version`; settings keep their historical `schemaVersion`), and
 * writes atomically with an fsync (`writeJsonAtomic`). It throws on I/O failure; a store whose
 * callers cannot afford that (settings, layout) catches and logs at its own call site.
 *
 * **A file from a newer Apiary.** If the file on disk records a version greater than the code's,
 * an older build is about to rewrite it with whatever subset of fields it understands. The policy
 * is deliberately the simplest one that loses nothing: before this store's *first* write it copies
 * the file to `<file>.v<N>.bak` (never overwriting an existing backup), then carries on as normal,
 * so the user keeps working and a later upgrade can recover what the older build dropped. If the
 * copy fails, `save` throws and the file is left untouched. `load` still reads such a file on a
 * best-effort basis through `parse`, which is why `parse` must ignore keys it does not know.
 */
export interface JsonStoreOptions<T> {
  file: string
  /** The shape version this code writes. Bump it when `parse` needs a new migration step. */
  version: number
  /** The key the version is stored under. Default `'version'`. */
  versionKey?: string
  parse: (raw: unknown, fromVersion: number | undefined) => T
  fallback: (reason: 'missing' | 'unreadable') => T
}

type RawRead = { ok: true, raw: unknown } | { ok: false, reason: 'missing' | 'unreadable' }

function readRaw(file: string): RawRead {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (e) {
    return { ok: false, reason: isRecord(e) && e.code === 'ENOENT' ? 'missing' : 'unreadable' }
  }
  try {
    return { ok: true, raw: JSON.parse(text) }
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
}

export class JsonStore<T extends object> {
  private readonly versionKey: string
  /** Whether the newer-version check has run; it only needs to, once, before the first write. */
  private checkedForNewer = false

  constructor(private readonly opts: JsonStoreOptions<T>) {
    this.versionKey = opts.versionKey ?? 'version'
  }

  load(): T {
    const read = readRaw(this.opts.file)
    if (!read.ok) return this.opts.fallback(read.reason)
    try {
      return this.opts.parse(read.raw, this.versionOf(read.raw))
    } catch {
      return this.opts.fallback('unreadable')
    }
  }

  save(data: T): void {
    mkdirSync(dirname(this.opts.file), { recursive: true })
    this.keepNewerFile()
    // The version goes first in a new file and keeps its place in one that already has the key.
    const stamp = { [this.versionKey]: this.opts.version }
    writeJsonAtomic(this.opts.file, Object.assign({}, stamp, data, stamp))
  }

  private versionOf(raw: unknown): number | undefined {
    const v = isRecord(raw) ? raw[this.versionKey] : undefined
    return isFiniteNumber(v) ? v : undefined
  }

  private keepNewerFile(): void {
    if (this.checkedForNewer) return
    const read = readRaw(this.opts.file)
    const found = read.ok ? this.versionOf(read.raw) : undefined
    if (found !== undefined && found > this.opts.version) {
      try {
        copyFileSync(this.opts.file, `${this.opts.file}.v${String(found)}.bak`, constants.COPYFILE_EXCL)
      } catch (e) {
        // A backup of this version from an earlier run is just as good; anything else aborts the write.
        if (!(isRecord(e) && e.code === 'EEXIST')) throw e
      }
    }
    this.checkedForNewer = true
  }
}
