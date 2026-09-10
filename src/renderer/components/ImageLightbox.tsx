import { useEffect } from 'react'
import { CloseIcon } from './icons'

/**
 * One image, full size, over everything else. Dismissed by Escape, by the close button, or by
 * clicking the backdrop — clicking the image itself does not, since dragging to select or simply
 * missing the edge of a large picture should not throw you out of it.
 */
export function ImageLightbox({ src, onClose }: { src: string; onClose: () => void }): JSX.Element {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [onClose])

  return (
    <div className="lightbox-backdrop" data-testid="image-lightbox" onClick={onClose}>
      <button className="lightbox-close" data-testid="image-lightbox-close" title="Close" aria-label="Close image">
        <CloseIcon />
      </button>
      <img
        className="lightbox-image"
        data-testid="image-lightbox-image"
        src={src}
        alt=""
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  )
}
