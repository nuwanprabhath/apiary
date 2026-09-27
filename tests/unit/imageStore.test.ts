import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ImageStore } from '../../src/main/media/imageStore'

describe('ImageStore', () => {
  let dir: string
  let store: ImageStore

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'apiary-images-'))
    store = new ImageStore({ dir })
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const onePixelPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

  it('save() writes the image and returns a path under the images directory', async () => {
    const path = await store.save(onePixelPngBase64, 'image/png')
    expect(path.startsWith(dir)).toBe(true)
    expect(path.endsWith('.png')).toBe(true)
    expect(existsSync(path)).toBe(true)
  })

  it('save() rejects an unsupported media type', async () => {
    await expect(store.save(onePixelPngBase64, 'image/svg+xml')).rejects.toThrow('Unsupported image type')
  })

  it('save() rejects an empty image', async () => {
    await expect(store.save('', 'image/png')).rejects.toThrow('That image was empty.')
  })

  it('save() rejects an image over the 20MB limit', async () => {
    const big = Buffer.alloc(21 * 1024 * 1024, 1).toString('base64')
    await expect(store.save(big, 'image/png')).rejects.toThrow('the limit is 20MB')
  })

  it('read() round-trips a saved image as a data URL', async () => {
    const path = await store.save(onePixelPngBase64, 'image/png')
    const result = await store.read(path)
    expect(result?.dataUrl.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('read() refuses a path outside the images directory (confinement)', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'apiary-images-outside-'))
    try {
      const escaped = join(outside, 'evil.png')
      expect(await store.read(escaped)).toBeNull()
      expect(await store.read(join(dir, '..', 'escaped.png'))).toBeNull()
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('read() returns null for a file that no longer exists', async () => {
    expect(await store.read(join(dir, 'gone.png'))).toBeNull()
  })

  it('read() returns null for a path whose extension is not a known image type', async () => {
    expect(await store.read(join(dir, 'notes.txt'))).toBeNull()
  })
})
