import { useEffect, useState } from 'react'

/** Absolute paths that look like an image file — how the composer hands an image to Claude. */
export const IMAGE_PATH_LINE = /^\s*(\/\S+\.(?:png|jpe?g|gif|webp))\s*$/i

/**
 * A thumbnail of an image that lives on disk (one pasted into the composer earlier in this
 * session), loaded through the main process because the renderer cannot read files itself.
 *
 * Renders nothing at all when the file has gone or sits outside the directory the main process is
 * willing to serve: a deleted screenshot should leave the message it accompanied looking ordinary,
 * not broken.
 */
export function TranscriptImageFile(
  { path, fallbackText, onOpen }:
  { path: string; fallbackText: string; onOpen: (src: string) => void },
): JSX.Element {
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.apiary.readImage(path).then((result) => {
      if (!cancelled) setDataUrl(result?.dataUrl ?? null)
    })
    return () => { cancelled = true }
  }, [path])

  // Falls back to showing the line exactly as it was sent. A path Apiary will not serve — one
  // outside its own images directory, or a screenshot since deleted — must not silently erase a
  // line the user actually wrote; better a visible path than a message with a hole in it.
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
