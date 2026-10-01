import { type RefObject, useEffect, useRef, useState } from 'react'
import { useEscape } from '../../ui/useEscape'

/**
 * A menu that opens above the message box (model, mode, commands): open/closed, and closed again
 * by Escape (through the shared stack, so it never closes something behind it) or by a press
 * anywhere outside `root`.
 */
export function usePopover(): { open: boolean; setOpen: (open: boolean) => void; root: RefObject<HTMLDivElement | null> } {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement | null>(null)
  useEscape(() => { setOpen(false) }, { enabled: open })
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!(e.target instanceof Node) || root.current?.contains(e.target) !== true) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => { document.removeEventListener('mousedown', onDown) }
  }, [open])
  return { open, setOpen, root }
}
