import { lstat, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { realPathInside } from '../fs/confine'

/**
 * Extensions for the image types worth accepting from a clipboard. The map is also the allow-list:
 * a media type absent from it is refused rather than written to disk under a guessed extension.
 */
const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
}

/** Refuse anything larger. A clipboard image this big is a mistake, and the path is sent to a CLI. */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024

export interface ImageStoreOptions {
  /** Where images pasted into the composer are written. */
  dir: string
}

export class ImageStore {
  private readonly dir: string

  constructor(options: ImageStoreOptions) {
    this.dir = options.dir
  }

  /**
   * Writes an image pasted into the composer to disk and returns its absolute path.
   *
   * On disk rather than inlined into the message because the path is what actually reaches Claude:
   * it reads the file itself. Kept in Apiary's own data directory rather than the session's working
   * directory so that pasting a screenshot never leaves untracked files in someone's repository.
   */
  async save(base64: string, mediaType: string): Promise<string> {
    const extension = IMAGE_EXTENSIONS[mediaType]
    if (extension === undefined) throw new Error(`Unsupported image type: ${mediaType}`)
    const bytes = Buffer.from(base64, 'base64')
    if (bytes.byteLength === 0) throw new Error('That image was empty.')
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      throw new Error(`That image is ${String(Math.round(bytes.byteLength / 1024 / 1024))}MB; the limit is 20MB.`)
    }
    await mkdir(this.dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const path = join(this.dir, `${stamp}-${randomUUID().slice(0, 8)}${extension}`)
    await writeFile(path, bytes)
    return path
  }

  /**
   * Reads one previously-saved image back as a data URL, for the thumbnails and the lightbox.
   *
   * Confined to the images directory, deliberately: the renderer supplies this path (it reads them
   * out of transcript text), and an unconstrained "read this file as a data URL" call handed to the
   * renderer would be a way to exfiltrate any file the app can see. The check is on real paths, so
   * neither `..` nor a symlink placed in the directory can lead out of it (`realPathInside`).
   */
  /**
   * Removes images last written before `cutoffMs` (epoch) that `referenced` does not name; returns how
   * many went. `referenced` is asked only when such an image exists, with the oldest one's mtime: no
   * file last written before an image existed can name it.
   */
  async pruneOlderThan(cutoffMs: number, referenced: (sinceMs: number) => Promise<Set<string>>): Promise<number> {
    const old: number[] = []
    await this.remove((_, mtimeMs) => { if (mtimeMs < cutoffMs) old.push(mtimeMs); return false })
    if (old.length === 0) return 0
    const keep = await referenced(Math.min(...old))
    return this.remove((name, mtimeMs) => mtimeMs < cutoffMs && !keep.has(name))
  }

  /** Removes every pasted image; returns how many went. */
  async clear(): Promise<number> {
    return this.remove(() => true)
  }

  private async remove(doomed: (name: string, mtimeMs: number) => boolean): Promise<number> {
    let names: string[]
    try { names = await readdir(this.dir) } catch { return 0 }
    let removed = 0
    for (const name of names) {
      const full = await realPathInside(this.dir, join(this.dir, name))
      if (full === null) continue
      const info = await lstat(full)
      if (!info.isFile() || !doomed(name, info.mtimeMs)) continue
      await rm(full, { force: true })
      removed += 1
    }
    return removed
  }

  async read(path: string): Promise<{ dataUrl: string } | null> {
    const full = await realPathInside(this.dir, path)
    if (full === null) return null
    const mediaType = Object.entries(IMAGE_EXTENSIONS)
      .find(([, ext]) => ext === extname(full).toLowerCase())?.[0]
    if (mediaType === undefined) return null
    try {
      const bytes = await readFile(full)
      return { dataUrl: `data:${mediaType};base64,${bytes.toString('base64')}` }
    } catch {
      // An image the user has since deleted: the thumbnail just doesn't render.
      return null
    }
  }
}
