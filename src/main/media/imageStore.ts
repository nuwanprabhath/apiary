import { mkdir, readFile, writeFile } from 'node:fs/promises'
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

/**
 * Pasted-image storage (MAIN-14 step 4), pure move out of `AppService`. Behaviour, error text and
 * the confinement check in `readImage` are unchanged; see `tests/unit/imageStore.test.ts`.
 */
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
      // A pasted image the user has since deleted is not an error worth interrupting them over —
      // the thumbnail simply doesn't render.
      return null
    }
  }
}
