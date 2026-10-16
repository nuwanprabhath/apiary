import { type JSX, useCallback, useState } from 'react'
import { CloseIcon } from '../../ui/icons'
import { useNotifications } from '../../ui/notifications'
import { saveImage } from '../../state/transcript'

/** One image waiting to be sent: where it now lives on disk, and a preview of it. */
export interface Attachment {
  /** Absolute path — this is what actually reaches Claude, which reads the file itself. */
  path: string
  /**
   * Data URL for the thumbnail. Deliberately not an object URL: the renderer is served from
   * `file://`, and the app's CSP allows images from `self` and `data:` only — a `blob:` preview is
   * silently blocked and renders as a zero-size box. A data URL also needs no revoking.
   */
  previewUrl: string
}

/** The image files in a paste or a drop. */
export function imagesFrom(list: DataTransfer | null): File[] {
  return [...(list?.files ?? [])].filter((f) => f.type.startsWith('image/'))
}

function readAsBase64(file: File): Promise<string> {
  return new Promise<string>((resolvePromise, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`))
    // readAsDataURL gives "data:<type>;base64,<payload>"; only the payload crosses the bridge.
    reader.onload = () => {
      const result = reader.result
      const text = typeof result === 'string' ? result : ''
      resolvePromise(text.split(',')[1] ?? '')
    }
    reader.readAsDataURL(file)
  })
}

/** The images waiting to go with the next message: saved to disk as they are added. */
export function useImageAttachments(): {
  attachments: Attachment[]
  addImages: (files: File[]) => Promise<void>
  removeImage: (path: string) => void
  clear: () => void
} {
  const { notifyError } = useNotifications()
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const addImages = useCallback(async (files: File[]): Promise<void> => {
    for (const file of files) {
      try {
        const base64 = await readAsBase64(file)
        const path = await saveImage(base64, file.type)
        setAttachments((prev) => [...prev, { path, previewUrl: `data:${file.type};base64,${base64}` }])
      } catch (e) {
        notifyError(e, 'Could not attach that image')
      }
    }
  }, [notifyError])
  const removeImage = useCallback((path: string): void => {
    setAttachments((prev) => prev.filter((x) => x.path !== path))
  }, [])
  const clear = useCallback((): void => { setAttachments([]) }, [])
  return { attachments, addImages, removeImage, clear }
}

/** The thumbnails above the box, each with a button to enlarge it and one to drop it. */
export function AttachmentStrip(
  { attachments, onOpenImage, onRemove }: {
    attachments: Attachment[]
    onOpenImage: (src: string) => void
    onRemove: (path: string) => void
  },
): JSX.Element {
  return (
    <div className="composer-attachments" data-testid="composer-attachments">
      {attachments.map((a) => (
        <div key={a.path} className="composer-attachment" data-testid="composer-attachment">
          <button
            className="composer-attachment-preview"
            data-testid="composer-attachment-preview"
            title={`${a.path}\n\nClick to enlarge`}
            onClick={() => onOpenImage(a.previewUrl)}
          >
            <img src={a.previewUrl} alt="" />
          </button>
          <button
            className="composer-attachment-remove"
            data-testid="composer-attachment-remove"
            title="Remove this image"
            aria-label="Remove this image"
            onClick={() => onRemove(a.path)}
          >
            <CloseIcon />
          </button>
        </div>
      ))}
    </div>
  )
}
