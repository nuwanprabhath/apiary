import { createElement, type JSX, type MouseEvent as ReactMouseEvent, type RefObject, useCallback, useEffect, useState } from 'react'
import { ContextMenu, type ContextMenuItem } from '../../ui/ContextMenu'
import { useNotifications } from '../../ui/notifications'
import { copyText } from '../../state/clipboard'

/** The selected text when it is non-empty and lies wholly inside `root`, else ''. */
function selectionWithin(root: HTMLElement | null): string {
  const sel = window.getSelection()
  if (root === null || sel === null || sel.isCollapsed || sel.rangeCount === 0) return ''
  const range = sel.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) return ''
  return sel.toString()
}

function inTextField(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('input, textarea') !== null
}

/**
 * Copy-on-select for a read-only region (the chat transcript), like the terminal: releasing the
 * mouse over a non-empty selection inside `ref` copies it and says how much was copied. Also a
 * right-click menu with "Copy", enabled only while something is selected.
 *
 * Wire up: `const { onContextMenu, menu } = useCopyOnSelect(ref)`; put `ref` and `onContextMenu`
 * on the element and render `{menu}` anywhere. Needs a NotificationProvider above it.
 */
export function useCopyOnSelect(ref: RefObject<HTMLElement | null>): {
  onContextMenu: (e: ReactMouseEvent<HTMLElement>) => void
  menu: JSX.Element | null
} {
  const { notify } = useNotifications()
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)
  const [selected, setSelected] = useState('')

  const copy = useCallback((text: string): void => {
    void copyText(text).then((ok) => {
      if (ok) notify({ kind: 'success', message: `Copied ${text.length} chars to clipboard`, timeoutMs: 2000 })
    })
  }, [notify])

  useEffect(() => {
    const el = ref.current
    if (el === null) return
    const onMouseUp = (e: MouseEvent): void => {
      if (e.button !== 0 || inTextField(e.target)) return
      const text = selectionWithin(el)
      if (text !== '') copy(text)
    }
    el.addEventListener('mouseup', onMouseUp)
    return () => { el.removeEventListener('mouseup', onMouseUp) }
  }, [ref, copy])

  const onContextMenu = useCallback((e: ReactMouseEvent<HTMLElement>): void => {
    if (inTextField(e.target)) return
    e.preventDefault()
    // Read at open, so "Copy" reflects the selection as it is at that moment.
    setSelected(selectionWithin(ref.current))
    setPosition({ x: e.clientX, y: e.clientY })
  }, [ref])

  const items: ContextMenuItem[] = [
    { id: 'copy', label: 'Copy', disabled: selected === '', run: () => { copy(selected) } },
  ]
  const menu = position === null
    ? null
    : createElement(ContextMenu, { items, position, onClose: () => { setPosition(null) }, testId: 'copy-menu' })
  return { onContextMenu, menu }
}
