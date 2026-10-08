import { type RefObject, useRef, useState } from 'react'
import { useEscape } from '../../ui/useEscape'
import { useOutsideDismiss } from '../../ui/useOutsideDismiss'

/**
 * A menu that opens above the message box (model, mode, commands): open/closed, and closed again
 * by Escape (through the shared stack, so it never closes something behind it) or by a press
 * anywhere outside `root`.
 */
export function usePopover(): { open: boolean; setOpen: (open: boolean) => void; root: RefObject<HTMLDivElement | null> } {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement | null>(null)
  useEscape(() => { setOpen(false) }, { enabled: open })
  useOutsideDismiss(() => { setOpen(false) }, { enabled: open, inside: [root] })
  return { open, setOpen, root }
}
