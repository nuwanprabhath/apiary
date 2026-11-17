import { copyFileSync, constants, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { isFiniteNumber, isRecord } from '@shared/guards'
import { writeJsonAtomic } from './atomicWrite'

/**
 * `JsonStore<T>`: the one way Apiary persists JSON state it reads back on its own (settings, the
 * window layout, themes, pets). A store is a file path, the version of the shape the code writes,
 * a `parse` that turns whatever is on disk into a valid `T`, and a `fallback` for when there is
 * nothing usable.
 *
 * **Reading (`load`).** Never throws. A missing file gives `fallback('missing')`; one that cannot
 * be read, is not JSON, or makes `parse` throw gives `fallback('unreadable')`, so a store can treat
 * "first run" differently from "damaged" (themes do). Otherwise `parse(raw, fromVersion)` gets the
 * decoded JSON (anything: a hand-edited file can hold any value) and the version recorded in it
 * (`undefined` when there is none). `parse` is where migration and validation live; it must be
 * total. A damaged file is left alone on disk until the next `save`.
 *
 * **Writing (`save`).** Creates the parent directory, stamps `version` under `versionKey` (default
 * `version`; settings keep `schemaVersion`) and writes atomically with an fsync (`writeJsonAtomic`).
 * It throws on I/O failure; a store whose callers cannot afford that catches and logs at its call site.
 *
 * **A file from a newer Apiary.** An older build would rewrite it with only the fields it
 * understands, so before this store's *first* write it copies the file to `<file>.v<N>.bak` (never
 * overwriting a backup). If the copy fails, `save` throws and the file is untouched. `load` still
 * reads such a file through `parse`, which must therefore ignore keys it does not know.
 *
 * **A damaged file.** When `load` found the file unreadable (not missing), the first `save` copies
 * it to `<file>.corrupt-<time>` before replacing it, keeping the newest 3 such copies.
 * `private: true` writes the file with mode 0600.
 */
export interface JsonStoreOptions<T> {
  file: string
  /** The shape version this code writes. Bump it when `parse` needs a new migration step. */
  version: number
  /** The key the version is stored under. Default `'version'`. */
  versionKey?: string
  /** Write with mode 0600, for a file holding a secret. */
  private?: boolean
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
  /** Set by `load` when the file existed but could not be used; cleared once it is copied aside. */
  private sawUnreadable = false

  constructor(private readonly opts: JsonStoreOptions<T>) {
    this.versionKey = opts.versionKey ?? 'version'
  }

  load(): T {
    const read = readRaw(this.opts.file)
    if (!read.ok) {
      this.sawUnreadable = read.reason === 'unreadable'
      return this.opts.fallback(read.reason)
    }
    try {
      return this.opts.parse(read.raw, this.versionOf(read.raw))
    } catch {
      this.sawUnreadable = true
      return this.opts.fallback('unreadable')
    }
  }

  save(data: T): void {
    mkdirSync(dirname(this.opts.file), { recursive: true })
    this.keepNewerFile()
    this.keepCorruptFile()
    // The version goes first in a new file and keeps its place in one that already has the key.
    const stamp = { [this.versionKey]: this.opts.version }
    writeJsonAtomic(this.opts.file, Object.assign({}, stamp, data, stamp), this.opts.private === true ? 0o600 : undefined)
  }

  private keepCorruptFile(): void {
    if (!this.sawUnreadable) return
    const { file } = this.opts
    try {
      copyFileSync(file, `${file}.corrupt-${String(Date.now())}`, constants.COPYFILE_EXCL)
    } catch (e) {
      if (isRecord(e) && e.code === 'ENOENT') { this.sawUnreadable = false; return }
      if (!(isRecord(e) && e.code === 'EEXIST')) throw e
    }
    this.sawUnreadable = false
    const prefix = `${basename(file)}.corrupt-`
    const copies = readdirSync(dirname(file))
      .filter(n => n.startsWith(prefix))
      .map(n => ({ n, t: Number(n.slice(prefix.length)) || 0 }))
      .sort((a, b) => b.t - a.t)
    for (const old of copies.slice(3)) rmSync(join(dirname(file), old.n), { force: true })
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
