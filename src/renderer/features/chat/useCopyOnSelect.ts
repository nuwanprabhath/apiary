import { createElement, type JSX, type MouseEvent as ReactMouseEvent, type RefObject, useCallback, useEffect, useState } from 'react'
import { ContextMenu } from '../../ui/ContextMenu'
import type { ContextMenuItem } from '../../ui/contextMenuItem'
import { useNotifications } from '../../ui/notifications'
import { copyRich, copyText } from '../../state/clipboard'
import { selectionFragmentWithin, selectionHtmlWithin } from './selectionHtml'
import { hasStructure, selectionText } from './selectionText'

/** The selected text when it is non-empty and lies wholly inside `root`, else ''. */
function selectionWithin(root: HTMLElement | null): string {
  const sel = window.getSelection()
  if (root === null || sel === null || sel.isCollapsed || sel.rangeCount === 0) return ''
  const range = sel.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) return ''
  // List numbers and bullets are CSS markers, so they are not in `toString()`: a selection with
  // structure is written out as text that has them. Running text inside one block copies as it is.
  const fragment = selectionFragmentWithin(root)
  return fragment !== null && hasStructure(fragment) ? selectionText(fragment) : sel.toString()
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
  const [selectedHtml, setSelectedHtml] = useState('')

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
    // The browser's own Ctrl/Cmd+C: the same text, and the selection's HTML so a paste keeps real lists.
    const onCopy = (e: ClipboardEvent): void => {
      if (inTextField(e.target) || e.clipboardData === null) return
      const text = selectionWithin(el)
      if (text === '') return
      e.preventDefault()
      e.clipboardData.setData('text/plain', text)
      const html = selectionHtmlWithin(el)
      if (html !== '') e.clipboardData.setData('text/html', html)
    }
    el.addEventListener('mouseup', onMouseUp)
    el.addEventListener('copy', onCopy)
    return () => {
      el.removeEventListener('mouseup', onMouseUp)
      el.removeEventListener('copy', onCopy)
    }
  }, [ref, copy])

  const onContextMenu = useCallback((e: ReactMouseEvent<HTMLElement>): void => {
    if (inTextField(e.target)) return
    e.preventDefault()
    // Read at open, so "Copy" reflects the selection as it is at that moment.
    setSelected(selectionWithin(ref.current))
    setSelectedHtml(selectionHtmlWithin(ref.current))
    setPosition({ x: e.clientX, y: e.clientY })
  }, [ref])

  const items: ContextMenuItem[] = [
    { id: 'copy', label: 'Copy', disabled: selected === '', run: () => { copy(selected) } },
    {
      id: 'copy-formatted',
      label: 'Copy with formatting',
      disabled: selected === '' || selectedHtml === '',
      run: () => {
        void copyRich(selectedHtml, selected).then((ok) => {
          if (ok) notify({ kind: 'success', message: 'Copied with formatting', timeoutMs: 2000 })
        })
      },
    },
  ]
  const menu = position === null
    ? null
    : createElement(ContextMenu, { items, position, onClose: () => { setPosition(null) }, testId: 'copy-menu' })
  return { onContextMenu, menu }
}
