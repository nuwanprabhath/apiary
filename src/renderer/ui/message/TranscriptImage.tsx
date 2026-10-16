import { type JSX, useEffect, useState } from 'react'
import { loadImage } from '../../state/transcript'

/** Absolute paths that look like an image file — how the composer hands an image to Claude. */
export const IMAGE_PATH_LINE = /^\s*(\/\S+\.(?:png|jpe?g|gif|webp))\s*$/i

/**
 * A thumbnail of an image that lives on disk (one pasted into the composer earlier in this
 * session), loaded through the main process because the renderer cannot read files itself.
 *
 * Shows `fallbackText` when the file has gone or sits outside the directory the main process is
 * willing to serve.
 */
export function TranscriptImageFile(
  { path, fallbackText, onOpen }:
  { path: string; fallbackText: string; onOpen: (src: string) => void },
): JSX.Element {
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    // A read failure looks like a missing file: the fallback text below, not a toast per thumbnail.
    void loadImage(path).then((result) => {
      if (!cancelled) setDataUrl(result?.dataUrl ?? null)
    })
    return () => { cancelled = true }
  }, [path])

  // A path Apiary will not serve (outside its images directory, or deleted) must not silently
  // erase a line the user wrote: show it as sent.
  if (dataUrl === null) return <p className="composer-path-fallback">{fallbackText}</p>
  return <ImageThumbnail src={dataUrl} title={path} onOpen={onOpen} />
}

/** The shared thumbnail: a small preview, clickable to see the whole thing. */
export function ImageThumbnail(
  { src, title, onOpen }: { src: string; title?: string; onOpen: (src: string) => void },
): JSX.Element {
  return (
    <button
      className="image-thumb"
      data-testid="image-thumb"
      title={title === undefined ? 'Click to enlarge' : `${title}\n\nClick to enlarge`}
      onClick={() => onOpen(src)}
    >
      <img src={src} alt="" />
    </button>
  )
}
